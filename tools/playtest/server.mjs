// Dependency-free static server for the repo root, on an ephemeral port.
//
// `make serve` uses python3; this uses node so the harness has exactly one runtime
// and can pick a free port instead of colliding with a server the user left running.
//
// /api/* is stubbed with an empty leaderboard rather than left to 404. A 404 there
// is harmless to the game (it handles the static-server case explicitly) but it
// puts a network error in the console, and the harness fails runs on console
// errors — so the stub is what keeps that check strict instead of fuzzy.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

export function serve(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(req.method === 'POST' ? '{"ok":true}' : '{"top":[],"total":0}');
      return;
    }
    // normalize() collapses ../ before the join, so the served tree stays inside root.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/`,
      close: () => new Promise(r => server.close(r)),
    }));
  });
}
