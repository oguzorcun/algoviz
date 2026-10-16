// Runs the harness under real Pyodide (the same runtime the browser worker uses)
// and compares step counts and results with the CPython run.
import { loadPyodide } from 'pyodide';
import fs from 'fs';

const root = new URL('..', import.meta.url).pathname;
const py = await loadPyodide();
py.runPython(fs.readFileSync(root + 'src/harness.py', 'utf8'));
const run = py.globals.get('run');
const samples = JSON.parse(fs.readFileSync(root + 'src/samples.json', 'utf8'));
let bad = 0;
for (const s of samples) {
  const res = JSON.parse(run(s.code, s.expr, 2000));
  const ref = JSON.parse(fs.readFileSync(`${root}test/out/${s.id}.json`, 'utf8'));
  // Object ids (heap keys) differ between interpreters, so compare the event trace itself.
  const seq = (r) => JSON.stringify(r.steps.map(x => [x.ev, x.line, x.call]));
  const same = seq(res) === seq(ref) && JSON.stringify(res.calls) === JSON.stringify(ref.calls);
  if (!same || res.error) bad++;
  console.log(s.id.padEnd(12), 'pyodide steps', res.steps.length, 'cpython', ref.steps.length,
    'calls', res.calls.length, same && !res.error ? 'MATCH' : 'MISMATCH', res.error || '');
}
console.log(bad ? `${bad} mismatches` : 'pyodide matches cpython on all samples');
process.exit(bad ? 1 : 0);
