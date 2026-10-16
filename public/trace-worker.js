// Classic worker: Pyodide and the trace harness live here so runaway code can be stopped
// by terminating the worker.
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let py = null;

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    if (type === 'init') {
      if (!py) {
        py = await loadPyodide({ indexURL: INDEX_URL });
        py.runPython(event.data.harness);
      }
      self.postMessage({ id, ok: true });
    } else if (type === 'run') {
      const run = py.globals.get('run');
      const json = run(event.data.code, event.data.expr, event.data.maxSteps);
      run.destroy();
      self.postMessage({ id, ok: true, json });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
