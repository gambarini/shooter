// Minimal Chrome DevTools Protocol client — zero dependencies.
//
// Node 22+ ships a global WebSocket, which is the only thing a CDP client really
// needs, so this file stands in for what would otherwise be a puppeteer install.
// That matters: the game is dependency-free by rule (CLAUDE.md), and a dev tool
// that needs `npm i` before it runs is a dev tool sessions skip.
//
// We attach straight to the page target's own websocket rather than to the browser
// endpoint, so there are no sessionIds to thread through every call.

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class CDP {
  #ws; #id = 0; #pending = new Map(); #listeners = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', ev => this.#onMessage(String(ev.data)));
    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer); reject(new Error('CDP socket closed'));
      }
      this.#pending.clear();
    });
  }

  #onMessage(raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.#listeners.get(msg.method) || []) fn(msg.params);
  }

  send(method, params = {}, { timeout = 30_000 } = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout after ${timeout}ms: ${method}`));
      }, timeout);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
  }

  // Evaluate in the page. `expression` may contain `return` — it is wrapped in an
  // IIFE — and objects come back by value, so everything the harness reads has to
  // be JSON-shaped. That is deliberate: it keeps probe payloads small and diffable.
  async eval(expression, { awaitPromise = false, timeout } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true, awaitPromise,
    }, timeout ? { timeout } : {});
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page exception: ' + (d.exception?.description || d.text || 'unknown'));
    }
    return r.result.value;
  }

  close() { try { this.#ws.close(); } catch {} }
}

// Poll /json/list until Chrome has a page target, then attach to it.
export async function attachToPage(port, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch { /* Chrome not listening yet */ }
    await sleep(150);
  }
  if (!target) throw new Error(`no CDP page target on port ${port} after ${timeoutMs}ms`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), { once: true });
  });
  return new CDP(ws);
}
