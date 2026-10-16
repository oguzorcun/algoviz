// Worst-ish case: 2000 traced steps, each serialising a 60-item list plus a 40-node list.
import { loadPyodide } from 'pyodide';
import fs from 'fs';
const py = await loadPyodide();
py.runPython(fs.readFileSync('src/harness.py', 'utf8'));
const run = py.globals.get('run');
const code = `def work(xs, head):
    total = 0
    cur = head
    for i in range(10000):
        total += xs[i % len(xs)]
        if cur is not None:
            cur = cur.next
    return total
`;
const expr = 'work(list(range(60)), build_list(list(range(40))))';
const t0 = Date.now();
const res = JSON.parse(run(code, expr, 2000));
console.log('steps', res.steps.length, 'truncated', res.truncated, 'ms', Date.now() - t0,
  'result', res.result && res.result.v, 'error', res.error);
const bytes = JSON.stringify(res).length;
console.log('trace JSON size KB', Math.round(bytes / 1024));
