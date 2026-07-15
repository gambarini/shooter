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
// KNOWN TRADEOFF — concurrency: submits do read-modify-write on a single blob, so
// two runs finishing at the same instant can clobber each other (last-write-wins).
// Accepted at hobby-scale traffic. Anti-abuse (forged scores, rate limiting,
// tokens) is deliberately out of scope here — that is roadmap item 39.

import { getStore } from '@netlify/blobs';
import { board, insertRun, validateRun } from '../lib/leaderboard-core.mjs';

const STORE = 'leaderboard';
const KEY = 'runs-v1';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function loadRuns(store) {
  const data = await store.get(KEY, { type: 'json' });
  return Array.isArray(data?.runs) ? data.runs : [];
}

export default async (req) => {
  const store = getStore(STORE);

  if (req.method === 'GET') {
    const runs = await loadRuns(store);
    const raw = new URL(req.url).searchParams.get('score');
    const score = raw == null ? NaN : Math.floor(Number(raw));
    return json(board(runs, score));
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const run = validateRun(body);
    if (!run) return json({ error: 'invalid run' }, 400);
    run.t = Date.now();

    const next = insertRun(await loadRuns(store), run);
    await store.setJSON(KEY, { runs: next });
    return json(board(next, run.s));
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/scores' };
