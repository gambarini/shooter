// NEON STRIKE — global leaderboard endpoint (Netlify Function, v2 ESM handler).
//
// Reached same-origin as /api/scores (netlify.toml rewrites it here), so the
// game's existing CSP `connect-src 'self'` already permits the fetch — no CSP
// change was needed.
//
//   GET  /api/scores            -> { top:[{name,score,wave}], total }
//   GET  /api/scores?score=N    -> { top, total, rank }   (rank of score N)
//   POST /api/scores {name,score,wave} -> { top, total, rank }  (rank of this run)
//
// This is a thin I/O shell: all ranking/validation lives in ../lib/leaderboard-core
// (pure, unit-tested with plain node). Here we only load/save one Blobs key and
// map to HTTP.
//
// ANTI-ABUSE (roadmap item 39) is layered on the POST path, all BEST-EFFORT — a
// global board on a static site is an unauthenticated public write endpoint that
// cannot be fully secured client-side; these only raise the bar against casual
// abuse. GET now also mints a short-lived submit token the client echoes on POST:
//   1. rate limit (per-IP, in-memory)  2. token check  3. validateRun  4. plausibility
//
// KNOWN TRADEOFF — concurrency: submits do read-modify-write on a single blob, so
// two runs finishing at the same instant can clobber each other (last-write-wins).
// Accepted at hobby-scale traffic. Anti-abuse (forged scores, rate limiting,
// tokens) is deliberately out of scope here — that is roadmap item 39.

import { getStore } from '@netlify/blobs';
import { board, insertRun, validateRun, plausibleRun } from '../lib/leaderboard-core.mjs';
import { issueToken, verifyToken } from '../lib/token.mjs';

const STORE = 'leaderboard';
// 'runs-v1' was the throwaway namespace used to deploy-verify item 36 (it holds
// ZZTEST/ZZPROBE entries and is now orphaned). 'board-v1' is the clean launch
// key. Bumping this constant is also the reset mechanism: there is no public
// delete endpoint by design (an unauthenticated wipe would be a hole), so to
// clear the board you roll the key.
const KEY = 'board-v1';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// STRONG consistency is required, not optional: this is a read-modify-write on a
// single key. With Blobs' default eventual consistency, a submit reads a stale
// (often empty) store, so sequential submits clobber each other and GETs lag —
// verified failing on the first live deploy. Strong reads cost a little latency
// but keep the board correct. (Concurrent submits can still race last-write-wins;
// that's the accepted hobby-scale tradeoff, see the header + item 39.)
async function loadRuns(store) {
  const data = await store.get(KEY, { type: 'json', consistency: 'strong' });
  return Array.isArray(data?.runs) ? data.runs : [];
}

// Per-IP submit rate limit — BEST-EFFORT and deliberately weak: this map lives in
// one warm function instance's memory, so a cold start clears it and concurrent
// instances each keep their own, meaning it's trivially bypassed at scale. It's
// here only to blunt a naive submit flood from a single client; it is NOT a real
// throttle. (A shared Blobs-backed limiter would survive across instances but
// doubles per-submit I/O — not worth it at hobby scale.) The map is pruned every
// call so it can't grow unbounded across warm invocations.
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

function clientIp(req) {
  return req.headers.get('x-nf-client-connection-ip') ||
         (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
         'unknown';
}

export default async (req) => {
  const store = getStore(STORE);

  if (req.method === 'GET') {
    const runs = await loadRuns(store);
    const raw = new URL(req.url).searchParams.get('score');
    const score = raw == null ? NaN : Math.floor(Number(raw));
    // Mint a submit token here: the client GETs this at run start and echoes the
    // token on its end-of-run POST (item 39 — best-effort deterrent).
    return json({ ...board(runs, score), token: issueToken() });
  }

  if (req.method === 'POST') {
    const now = Date.now();

    // 1. Rate limit (per-IP, best-effort in-memory — see rateLimited()).
    if (rateLimited(clientIp(req), now)) return json({ error: 'rate limited' }, 429);

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }

    // 2. Submit token — rejects a naive POST that never asked for one. Deterrent
    // only: the token is observable in-page, so a determined client can replay it.
    if (!verifyToken(body?.token, now)) return json({ error: 'missing or expired token' }, 403);

    // 3. Structural validation + clamp (malformed payload).
    const run = validateRun(body);
    if (!run) return json({ error: 'invalid run' }, 400);

    // 4. Score-for-wave plausibility (well-formed but implausibly high).
    if (!plausibleRun(run.s, run.w)) return json({ error: 'implausible score' }, 422);

    run.t = now;
    const next = insertRun(await loadRuns(store), run);
    await store.setJSON(KEY, { runs: next });
    return json(board(next, run.s));
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/scores' };
