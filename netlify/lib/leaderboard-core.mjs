// NEON STRIKE — global leaderboard: PURE logic (no I/O, no external deps).
//
// Deliberately kept free of `@netlify/blobs` and Node/network APIs so it can be
// unit-tested with plain `node` (the Blobs round-trip only runs on a real
// Netlify deploy). scores.mjs (the handler) is the thin I/O shell around this.
//
// The store keeps EVERY run's score, sorted by score descending. That is what
// lets us answer "You ranked #347 of N" — a top-N-only store cannot rank a
// score that isn't in the top-N. See roadmap item 36 for why this matters.

export const MAX_NAME = 12;
export const MAX_SCORE = 100_000_000; // sanity ceiling; real anti-cheat is item 39
export const MAX_WAVE = 10_000;
export const TOP_N = 10;
// Hard cap on stored runs so the single blob can't grow without bound. Far above
// any realistic hobby-scale total; if ever exceeded, the lowest scores are
// dropped, which only degrades `total` and the rank of very-low scores.
export const MAX_RUNS = 100_000;

// Strip control chars and angle brackets (a belt against HTML injection in the
// rendered table — full escaping still happens at render, item 38/39), collapse
// whitespace, clamp length. Empty -> "ANON".
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'ANON';
  const cleaned = raw
    .replace(/[\p{Cc}<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  return cleaned || 'ANON';
}

// Validate + clamp an incoming run. Returns a compact {n,s,w} record, or null if
// the payload is unusable (the handler turns null into a 400). No timestamp here
// — the handler stamps `t` so this stays pure/deterministic for tests.
export function validateRun(body) {
  if (!body || typeof body !== 'object') return null;
  const s = Math.floor(Number(body.score));
  const w = Math.floor(Number(body.wave));
  if (!Number.isFinite(s) || s < 0 || s > MAX_SCORE) return null;
  if (!Number.isFinite(w) || w < 1 || w > MAX_WAVE) return null;
  return { n: sanitizeName(body.name), s, w };
}

// Insert `run` into a score-descending array, preserving order. Existing runs of
// an equal score keep priority (new run goes after them), so ties rank by who
// got there first. Returns a new array; does not mutate `runs`.
export function insertRun(runs, run) {
  let lo = 0, hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid].s < run.s) hi = mid; else lo = mid + 1;
  }
  const next = runs.slice();
  next.splice(lo, 0, run);
  if (next.length > MAX_RUNS) next.length = MAX_RUNS; // drop the lowest tail
  return next;
}

// Rank of `score` = (runs scoring strictly higher) + 1. `runs` is sorted desc,
// so we can stop at the first score that isn't higher.
export function rankOf(runs, score) {
  let above = 0;
  for (const r of runs) {
    if (r.s > score) above++; else break;
  }
  return above + 1;
}

export function topN(runs, n = TOP_N) {
  return runs.slice(0, n).map(r => ({ name: r.n, score: r.s, wave: r.w }));
}

// The public board payload. `score` (optional) adds the caller's rank for that
// score — used so a just-submitted run learns its placement without a 2nd query.
export function board(runs, score) {
  const out = { top: topN(runs), total: runs.length };
  if (Number.isFinite(score)) out.rank = rankOf(runs, score);
  return out;
}
