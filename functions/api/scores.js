// NEON STRIKE — global leaderboard endpoint (Cloudflare Pages Function + D1).
//
// Ported from netlify/functions/scores.mjs in roadmap item 52. Pages uses
// FILE-BASED ROUTING, so this file's path IS the route: functions/api/scores.js
// serves /api/scores. Nothing declares it (the Netlify version needed
// `export const config = { path: '/api/scores' }`).
//
// Because Pages Functions run on the SAME ORIGIN as index.html, the game needed
// zero changes: `fetch('/api/scores')` and the CSP's `connect-src 'self'` both
// keep working verbatim. That same-origin property is the whole reason Cloudflare
// was chosen over a separate database vendor.
//
//   GET  /api/scores            -> { top:[{name,score,wave}], total, token }
//   GET  /api/scores?score=N    -> { top, total, rank, token }   (rank of score N)
//   POST /api/scores {name,score,wave,token} -> { top, total, rank }  (rank of this run)
//
// This is a thin I/O shell: name sanitizing, payload validation and score
// plausibility live in ../../lib/leaderboard-core.mjs (pure, and unit-tested by
// lib/leaderboard-core.test.mjs under plain node).
//
// WHAT D1 FIXED. The Netlify version did read-modify-write on a single Blobs key,
// so two runs finishing at the same instant could clobber each other
// (last-write-wins, documented and accepted there). A submit is now an INSERT, so
// that race is gone — not mitigated, structurally absent. Ranking likewise went
// from an O(n) walk over every stored run to an indexed `count(*) WHERE score > ?`.
//
// ANTI-ABUSE (roadmap item 39, absorbed into this item) is layered on the POST
// path and remains BEST-EFFORT: a global board on a static site is an
// unauthenticated public write endpoint, and no amount of client-side ceremony
// changes that. In order: rate limit -> single-use token -> validateRun ->
// plausibility. The token is now a D1 row deleted on use, which is STRONGER than
// the HMAC it replaces (that one was replayable by its own admission) and needs
// no signing secret — so SCORE_SECRET is gone too.

import { TOP_N, validateRun, plausibleRun } from '../../lib/leaderboard-core.mjs';

// Token lifetime. Issued at run START (index.html calls fetchRunToken() from
// startGame(), not at page load), so it only has to outlast one run — generous so
// a long or AFK run never has its score silently rejected. The deterrent value is
// binary (has-a-token vs none), so a long TTL costs nothing that matters.
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

// Minimum time between token issue and submit. THIS NUMBER IS ANCHORED to where
// the token is issued: startGame(), i.e. real run start, so the floor applies to
// actual run length. Kept deliberately low — a fumbled wave-1 death is a genuine
// run, must still submit, and scores near-nothing anyway. Do not raise it without
// re-checking that fetchRunToken() is still called at run start.
const MIN_RUN_MS = 5_000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// Per-IP submit rate limit — BEST-EFFORT and deliberately weak, even weaker here
// than on Netlify: this Map lives in one Worker ISOLATE's memory, and isolates are
// per-colo, short-lived and numerous, so it is trivially bypassed at scale. It is
// here only to blunt a naive submit flood from one client. The real single-winner
// guarantee is the token row (below), which is backed by D1 and therefore global.
// A D1-backed limiter would survive across isolates but would add row writes to
// every request — not worth it at hobby scale. The map is pruned every call so it
// cannot grow unbounded across requests served by the same isolate.
const RATE_MAX = 10;               // submits allowed...
const RATE_WINDOW_MS = 60_000;     // ...per IP per this window
const hits = new Map();            // ip -> number[] of recent submit timestamps

function rateLimited(ip, now) {
  for (const [k, times] of hits) {
    const kept = times.filter(t => now - t < RATE_WINDOW_MS);
    if (kept.length) hits.set(k, kept); else hits.delete(k);   // prune
  }
  const mine = hits.get(ip) || [];
  if (mine.length >= RATE_MAX) return true;
  mine.push(now);
  hits.set(ip, mine);
  return false;
}

// Cloudflare's client-IP header. NOT the Netlify one — `x-nf-client-connection-ip`
// does not exist here, and falling through to 'unknown' would put every visitor in
// ONE rate-limit bucket (10 submits/minute globally, then real players get 429s).
// `wrangler pages dev` does not set CF-Connecting-IP, so local requests all share
// the 'unknown' bucket; that is a local-dev artifact, not deployed behaviour.
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') ||
         (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
         'unknown';
}

// The public board payload: top N + total, plus `rank` when a score is supplied.
// Rank = (runs scoring strictly higher) + 1, so ties share a rank — identical to
// the array-walking rankOf() this replaces. One batch = one round trip.
async function readBoard(db, score) {
  const wantRank = Number.isFinite(score);
  const stmts = [
    // `order by score desc, id asc` matches the runs_board index exactly, and the
    // id tiebreaker means equal scores rank by who got there first.
    db.prepare('select name, score, wave from runs order by score desc, id asc limit ?').bind(TOP_N),
    db.prepare('select count(*) as total from runs'),
  ];
  if (wantRank) stmts.push(db.prepare('select count(*) as above from runs where score > ?').bind(score));

  const res = await db.batch(stmts);
  const out = {
    top: res[0].results.map(r => ({ name: r.name, score: r.score, wave: r.wave })),
    total: res[1].results[0].total,
  };
  if (wantRank) out.rank = res[2].results[0].above + 1;
  return out;
}

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  const raw = new URL(request.url).searchParams.get('score');
  const score = raw == null ? NaN : Math.floor(Number(raw));

  try {
    // Reap expired tokens. Necessary because a token is only deleted when a run
    // actually submits: every abandoned run (page closed mid-game) leaves a row
    // nobody will ever consume. Doing it on GET keeps the table bounded without a
    // cron trigger, and costs one indexed delete on the path that creates rows.
    await env.DB.prepare('delete from submit_tokens where expires_at < ?').bind(now).run();

    // Mint this run's submit token. crypto.randomUUID() is on the Workers global —
    // no node:crypto and therefore no nodejs_compat flag needed.
    const token = crypto.randomUUID();
    await env.DB.prepare('insert into submit_tokens (token, issued_at, expires_at) values (?, ?, ?)')
      .bind(token, now, now + TOKEN_TTL_MS).run();

    return json({ ...await readBoard(env.DB, score), token });
  } catch (err) {
    // The client treats any non-OK response as "offline" and keeps the local
    // recap, so a DB fault degrades the death screen instead of breaking it.
    return json({ error: 'leaderboard unavailable', detail: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const now = Date.now();

  // 1. Rate limit (per-IP, best-effort in-isolate — see rateLimited()).
  if (rateLimited(clientIp(request), now)) return json({ error: 'rate limited' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  try {
    // 2. Single-use submit token.
    //
    // Deliberately NOT `delete ... returning`: D1 documents the results array as
    // empty for write operations, so a RETURNING row may never surface through
    // .first(). Were that to return null, EVERY legitimate submit would 403 — a
    // total outage wearing the costume of "the leaderboard is down". So: select
    // the row, then delete it and require meta.changes === 1. That check is the
    // authoritative single-winner test against a concurrent replay (only one
    // deleter can observe changes === 1) and relies solely on documented behaviour.
    const tok = typeof body?.token === 'string' ? body.token : null;
    if (!tok) return json({ error: 'missing token' }, 403);

    const row = await env.DB.prepare('select issued_at from submit_tokens where token = ?')
      .bind(tok).first();
    // Unknown token: never issued, or already consumed by an earlier submit — that
    // second case is the replay, and it lands here.
    if (!row) return json({ error: 'unknown or already-used token' }, 403);

    const del = await env.DB.prepare('delete from submit_tokens where token = ?').bind(tok).run();
    if (del.meta.changes !== 1) return json({ error: 'token already used' }, 403);

    // Both ends of the token's validity window. The floor rejects a submit that
    // arrives implausibly soon after run start; the ceiling is what expires_at is
    // for (the reaper above is opportunistic, so an unswept row must still be
    // rejected on its own merits here).
    if (now - row.issued_at < MIN_RUN_MS) return json({ error: 'run too short' }, 403);
    if (now - row.issued_at > TOKEN_TTL_MS) return json({ error: 'token expired' }, 403);

    // 3. Structural validation + clamp (malformed payload).
    const run = validateRun(body);
    if (!run) return json({ error: 'invalid run' }, 400);

    // 4. Score-for-wave plausibility (well-formed but implausibly high).
    if (!plausibleRun(run.s, run.w)) return json({ error: 'implausible score' }, 422);

    await env.DB.prepare('insert into runs (name, score, wave, created_at) values (?, ?, ?, ?)')
      .bind(run.n, run.s, run.w, now).run();

    return json(await readBoard(env.DB, run.s));
  } catch (err) {
    return json({ error: 'leaderboard unavailable', detail: String(err?.message || err) }, 500);
  }
}

// No other method is exported on purpose: Pages answers unhandled methods on a
// routed file with 405 itself, so there is nothing to hand-roll.
