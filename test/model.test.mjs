// Checks the view model against real traces produced by the Python harness.
import fs from 'fs';
import assert from 'assert';
import { buildStepView, layoutHeap } from '../src/model.js';

const root = new URL('..', import.meta.url).pathname;
const load = (id) => JSON.parse(fs.readFileSync(`${root}test/out/${id}.json`, 'utf8'));
const allRoots = (t) => {
  const found = [];
  t.steps.forEach((_, i) => {
    const v = buildStepView(t.steps, i, {}, t.calls);
    v.roots.forEach((r) => found.push({ i, r, v }));
  });
  return found;
};
const hasRoot = (t, name, kind) =>
  allRoots(t).some(({ r }) => r.names.includes(name) && r.kind === kind);

// Every step of every sample must build a view without throwing.
const ids = ['stairs', 'reverse', 'tree', 'graph', 'heap', 'two-pointer', 'islands', 'longest', 'two-sum', 'product-except-self', 'coin-change', 'container-water'];
for (const id of ids) {
  const t = load(id);
  t.steps.forEach((_, i) => buildStepView(t.steps, i, {}, t.calls));
}
console.log('all steps build without error');

const reverse = load('reverse');
assert(hasRoot(reverse, 'head', 'list'), 'linked list root detected');
console.log('linked list: head -> list view');

const tree = load('tree');
assert(hasRoot(tree, 'root', 'tree'), 'tree root detected');
console.log('tree: root -> tree view');

const graph = load('graph');
assert(hasRoot(graph, 'graph', 'graph'), 'adjacency list detected as graph');
const gSteps = allRoots(graph).filter(({ r }) => r.kind === 'graph');
assert(gSteps.some(({ v }) => Object.keys(v.ctx.byKey).length > 0), 'cursor node labels');
assert(gSteps.some(({ v }) => v.ctx.seen.size > 0), 'visited set marks nodes as seen');
console.log('graph: adjacency list -> graph view, cursors and seen nodes');

const heap = load('heap');
assert(hasRoot(heap, 'heap', 'heap'), 'list used with heapq becomes a heap');
console.log('heap: list passed to heapq -> heap view');

const tp = load('two-pointer');
assert(hasRoot(tp, 'nums', 'array'), 'plain list -> array');
assert(allRoots(tp).some(({ v }) => Object.keys(v.ctx.ptrs).length > 0), 'l and r pointers');
console.log('array: nums -> array view, l/r pointer labels');

const isl = load('islands');
assert(hasRoot(isl, 'grid', 'grid'), 'rows of strings -> grid');
assert(allRoots(isl).some(({ v }) => v.ctx.cell.r !== null && v.ctx.cell.c !== null), 'current cell tracked');
console.log('grid: grid -> grid view, current cell tracked');

const stairs = load('stairs');
const last = buildStepView(stairs.steps, stairs.steps.length - 1, {}, stairs.calls);
assert(last.tree && last.tree.nodes.length === stairs.calls.length, 'call tree has one node per call');
console.log('call tree: one node per recursive call');

const hl = layoutHeap(7);
assert.equal(hl.depth, 2);
assert.equal(hl.edges.length, 6);
console.log('heap layout ok');
const lg = load('longest');
assert(hasRoot(lg, 's', 'array'), 'string of 2+ chars -> array of characters');
const lgAll = allRoots(lg);
assert(lgAll.some(({ v }) => v.ctx.win && v.ctx.win.lo <= v.ctx.win.hi), 'sliding window between left and right');
assert(lgAll.some(({ v }) => v.ctx.ptrs[v.ctx.win?.hi] && v.ctx.ptrs[v.ctx.win.hi].includes('right')), 'right pointer on string');
console.log('string: s -> array, left/right window and pointers');
// Subscript accesses drive the highlights.
const anyAccess = (t, pred) => allRoots(t).some(({ v }) => Object.values(v.ctx.access).some(pred));
const pe = load('product-except-self');
assert(anyAccess(pe, (a) => a.w.size > 0), 'writes out[i] = ... are recorded');
assert(anyAccess(pe, (a) => a.r.size > 0), 'reads nums[i] are recorded');
assert(hasRoot(pe, 'out', 'array'), 'out is an array root');
const ts = load('two-sum');
assert(anyAccess(ts, (a) => a.r.size > 0), 'two-sum reads nums[i]');
assert(anyAccess(ts, (a) => a.w.size > 0), 'two-sum writes seen[nums[i]]');
const cc = load('coin-change');
assert(hasRoot(cc, 'dp', 'array'), 'dp table is an array root');
assert(allRoots(cc).some(({ v }) => v.roots.some(r => r.names.includes('dp') && Object.values(v.ctx.access).some(a => a.w.size > 0))), 'dp writes recorded');
const cw = load('container-water');
assert(anyAccess(cw, (a) => a.r.size > 0), 'height[l], height[r] reads recorded');
console.log('subscript accesses: reads and writes recorded for DP, hash map, arrays');
console.log('model tests passed');
