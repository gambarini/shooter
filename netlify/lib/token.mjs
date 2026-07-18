// NEON STRIKE — submit-token issue/verify (roadmap item 39, anti-abuse).
//
// BEST-EFFORT DETERRENT ONLY. This is a global leaderboard on a static site: an
// unauthenticated public write endpoint. A token issued to the page is, by
// construction, observable in-page — a determined client can read it and replay
// it on a forged POST. What this DOES buy: a naive `curl`/console POST that never
// asked for a token is rejected. That's the whole (modest) goal.
//
// Kept in its own module (not scores.mjs) so it's unit-testable with plain node:
// node:crypto is a plain-node builtin, but scores.mjs imports @netlify/blobs
// (not installed for bare node), so anything inline there can't be node-tested.
// Kept out of leaderboard-core.mjs too — that file deliberately bans Node APIs.

import { createHmac, timingSafeEqual } from 'node:crypto';

// The signing secret. In production set SCORE_SECRET in the Netlify env; the
// fallback below is public (it lives in the repo), which makes the token a pure
// deterrent when unset — that's acceptable per the best-effort framing above.
const SECRET = process.env.SCORE_SECRET || 'neon-strike-public-dev-secret';

// Token lifetime. Issued at run start (client GETs /api/scores then), so this
// only has to outlast a single run — generous here so a long/AFK run never has
// its score silently rejected. Longer TTL trades deterrent strength for that
// safety; the deterrent value is binary (has-a-token vs none), so 6h is fine.
export const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function sign(expStr) {
  return createHmac('sha256', SECRET).update(expStr).digest('hex');
}

// Mint a token bound to an expiry: "<exp>.<hmac(exp)>". `now` is injectable so
// tests are deterministic; the handler passes Date.now().
export function issueToken(now = Date.now()) {
  const exp = String(now + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

// True iff `token` is well-formed, unexpired, and correctly signed. Any parse
// failure, expiry, or signature mismatch returns false (never throws).
export function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(expStr);
  if (sig.length !== expected.length) return false;   // timingSafeEqual needs equal lengths
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
