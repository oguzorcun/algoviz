// Main-thread client for the trace worker. Owns the worker lifecycle and timeouts.
import HARNESS from './harness.py?raw';

const LOAD_MS = 120000;  // first run downloads Python (~10 MB)
const RUN_MS = 20000;    // a run that takes longer is treated as an infinite loop
const WORKER_URL = `${import.meta.env.BASE_URL}trace-worker.js`;

export class TraceClient {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.seq = 0;
    this.waiting = new Map();
  }

  start() {
    const w = new Worker(WORKER_URL);
    w.onmessage = (e) => {
      const p = this.waiting.get(e.data.id);
      if (!p) return;
      this.waiting.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => this.reset(new Error('Worker crashed: ' + (e.message || 'unknown error')));
    this.worker = w;
    this.ready = this.call({ type: 'init', harness: HARNESS }, LOAD_MS);
    this.ready.catch(() => {});
    return this.ready;
  }

  call(msg, ms) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset(new Error(
        `Stopped after ${ms / 1000}s. The code may loop forever. Python restarts on the next run.`)), ms);
      this.waiting.set(id, {
        resolve: (d) => { clearTimeout(timer); resolve(d); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.worker.postMessage({ id, ...msg });
    });
  }

  async run(code, expr, maxSteps) {
    try {
      if (!this.worker) this.start();
      await this.ready;
      const msg = await this.call({ type: 'run', code, expr, maxSteps }, RUN_MS);
      const trace = JSON.parse(msg.json);
      trace.code = code;
      return trace;
    } catch (err) {
      this.reset();
      throw err;
    }
  }

  reset(err = new Error('Tracer stopped')) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.waiting.values()) p.reject(err);
    this.waiting.clear();
  }
}
