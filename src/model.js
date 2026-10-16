// View-model logic: turns one trace step into what the visualizer draws.
// Pure functions (no DOM, no React) so they can be tested under Node.

const set = (xs) => new Set(xs);
// Variable names that act as indices / cursors / node ids. Used only for pointer labels.
export const INDEX_NAMES = set(['i', 'j', 'k', 'l', 'r', 'lo', 'hi', 'mid', 'left', 'right',
  'start', 'end', 'idx', 'index', 'p', 'q', 'slow', 'fast']);
export const NODE_NAMES = set(['node', 'u', 'v', 'cur', 'curr', 'src', 'dst', 'nei', 'neighbor',
  'x', 'y', 's', 't', 'start']);
export const ROW_NAMES = ['r', 'row', 'i'];
export const COL_NAMES = ['c', 'col', 'j'];
const CONTAINERS = set(['list', 'tuple', 'deque', 'set', 'dict', 'lnode', 'tnode', 'obj']);

export const isRef = (v) => v !== null && typeof v === 'object' && '$' in v;
export const isRepr = (v) => v !== null && typeof v === 'object' && 'repr' in v;
export const refOf = (v) => (isRef(v) ? v.$ : null);
export const entryOf = (v, heap) => {
  const o = refOf(v);
  return o === null ? null : heap[o] ?? null;
};
const addName = (map, key, name) => {
  const xs = (map[key] ??= []);
  if (!xs.includes(name)) xs.push(name);
};

// Object ids directly referenced by an entry's fields.
export function childRefs(e) {
  if (!e) return [];
  let vals = [];
  switch (e.k) {
    case 'list': case 'tuple': case 'deque': case 'set': vals = e.items; break;
    case 'dict': vals = e.items.flat(); break;
    case 'lnode': vals = [e.val, e.next]; break;
    case 'tnode': vals = [e.val, e.left, e.right]; break;
    case 'obj': vals = e.attrs.map(([, x]) => x); break;
    default: break;
  }
  return vals.filter(isRef).map(refOf);
}

// Every object id reachable from oid (including oid).
export function reach(oid, heap) {
  const seen = new Set([oid]);
  const stack = [oid];
  while (stack.length) {
    for (const c of childRefs(heap[stack.pop()])) {
      if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  return seen;
}

// Short, Python-like text for any value.
export function summary(v, heap, depth = 0) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v}'`;
  if (isRepr(v)) return v.repr;
  const e = entryOf(v, heap);
  if (!e) return '…';
  if (depth > 3) return '…';
  const s = (x) => summary(x, heap, depth + 1);
  const more = (e.n ?? 0) > (e.items?.length ?? 0) ? ', …' : '';
  switch (e.k) {
    case 'list': return `[${e.items.map(s).join(', ')}${more}]`;
    case 'tuple': return `(${e.items.map(s).join(', ')}${more})`;
    case 'deque': return `deque([${e.items.map(s).join(', ')}${more}])`;
    case 'set': return e.items.length ? `{${e.items.map(s).join(', ')}${more}}` : 'set()';
    case 'dict': return `{${e.items.map(([a, b]) => `${s(a)}: ${s(b)}`).join(', ')}}`;
    case 'lnode': {
      const parts = [];
      const seen = new Map();
      let cur = v;
      for (;;) {
        const o = refOf(cur);
        const ce = entryOf(cur, heap);
        if (!ce || ce.k !== 'lnode') { parts.push('…'); break; }
        if (seen.has(o)) { parts.push('↺'); break; }
        seen.set(o, parts.length);
        parts.push(s(ce.val));
        if (!isRef(ce.next)) { parts.push('None'); break; }
        cur = ce.next;
      }
      return parts.join(' → ');
    }
    case 'tnode': return `Tree(${s(e.val)})`;
    case 'obj': return `${e.cls}(…)`;
    case 'repr': return e.text;
    default: return '…';
  }
}

// A list of lists of valid node ids, or a dict of node -> list of keys. Otherwise null.
export function adjacencyOf(e, heap) {
  if (!e) return null;
  if (e.k === 'list') {
    const n = e.items.length;
    if (!n) return null;
    const rows = e.items.map((x) => entryOf(x, heap));
    if (!rows.every((r) => r && r.k === 'list')) return null;
    const ok = rows.every((r) => r.items.every((x) => Number.isInteger(x) && x >= 0 && x < n));
    if (!ok) return null;
    return { ids: rows.map((_, i) => i), nbrs: rows.map((r) => r.items) };
  }
  if (e.k === 'dict' && e.items.length) {
    const keys = e.items.map(([k]) => k);
    if (keys.some(isRef)) return null;
    const index = new Map(keys.map((k, i) => [String(k), i]));
    const nbrs = [];
    for (const [, v] of e.items) {
      const r = entryOf(v, heap);
      if (!r || r.k !== 'list' || !r.items.every((x) => !isRef(x) && index.has(String(x)))) return null;
      nbrs.push(r.items.map((x) => index.get(String(x))));
    }
    return { ids: keys, nbrs };
  }
  return null;
}

function rectangular(e, heap) {
  const lens = e.items.map((x) => entryOf(x, heap)?.items?.length);
  return lens.every((l) => l === lens[0]);
}

// Which view draws this entry. Heuristic: a 2D list is a graph only when it looks like an
// adjacency list (valid ids, jagged). Users can override the choice per structure.
export function kindOf(e, heap) {
  switch (e?.k) {
    case 'list':
      if (e.heap) return 'heap';
      if (e.items.length && e.items.every((x) => entryOf(x, heap)?.k === 'list')) {
        return adjacencyOf(e, heap) && !rectangular(e, heap) ? 'graph' : 'grid';
      }
      return 'array';
    case 'tuple': return 'array';
    case 'deque': return 'queue';
    case 'set': return 'set';
    case 'dict': return adjacencyOf(e, heap) ? 'graph' : 'map';
    case 'lnode': return 'list';
    case 'tnode': return 'tree';
    case 'obj': return 'object';
    default: return 'value';
  }
}

// In-order x positions for a binary tree rooted at rootOid.
export function layoutTree(rootOid, heap) {
  const pos = new Map();
  const edges = [];
  let next = 0;
  const walk = (oid, depth) => {
    const e = heap[oid];
    if (!e || e.k !== 'tnode' || pos.has(oid)) return;
    pos.set(oid, { x: -1, y: depth, val: e.val });
    const L = refOf(e.left);
    const R = refOf(e.right);
    if (L !== null && heap[L]) { edges.push([oid, L]); walk(L, depth + 1); }
    pos.get(oid).x = next++;
    if (R !== null && heap[R]) { edges.push([oid, R]); walk(R, depth + 1); }
  };
  walk(rootOid, 0);
  return { nodes: [...pos].map(([oid, p]) => ({ oid, ...p })), edges };
}

// Array-as-binary-tree layout for heaps: node i has children 2i+1 and 2i+2.
export function layoutHeap(n) {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const d = Math.floor(Math.log2(i + 1));
    const first = 2 ** d - 1;
    nodes.push({ i, depth: d, pos: (i - first + 0.5) / 2 ** d });
    if (i > 0) edges.push([Math.floor((i - 1) / 2), i]);
  }
  return { nodes, edges, depth: nodes.length ? nodes[nodes.length - 1].depth : 0 };
}

// Call tree of every user function call that has started by step i.
// `current` is the call that produced step i; its ancestors are marked as the path.
export function callTree(calls, i, current) {
  if (!calls || !calls.length) return null;
  const visible = calls.map((c, id) => ({ ...c, id })).filter((c) => c.start <= i);
  if (!visible.length) return null;
  const kids = new Map(visible.map((c) => [c.id, []]));
  const roots = [];
  for (const c of visible) {
    if (c.parent !== null && kids.has(c.parent)) kids.get(c.parent).push(c.id);
    else roots.push(c.id);
  }
  const path = new Set();
  for (let id = current ?? null; id !== null && calls[id]; id = calls[id].parent) path.add(id);

  const pos = new Map();
  const edges = [];
  let leaf = 0;
  const place = (id, depth) => {
    const ks = kids.get(id);
    if (!ks.length) { pos.set(id, { x: leaf++, y: depth }); return; }
    ks.forEach((k) => { edges.push([id, k]); place(k, depth + 1); });
    const xs = ks.map((k) => pos.get(k).x);
    pos.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth });
  };
  roots.forEach((r) => place(r, 0));

  const nodes = visible.map((c) => {
    const done = c.retStep !== null && c.retStep <= i;
    const args = c.args.map(([, r]) => r).join(', ');
    const text = `${c.fn}(${args})` + (done ? ` = ${c.ret}` : '');
    const p = pos.get(c.id);
    return { id: c.id, text, x: p.x, y: p.y, done,
      active: c.id === current, onPath: path.has(c.id) && c.id !== current };
  });
  return { nodes, edges };
}

// Strings of 2+ characters (up to 200) become sequence structures, so they can be
// indexed and pointed at like a list. Single characters stay plain values.
function withStrings(step) {
  const heap = { ...(step.heap || {}) };
  const strOid = new Map();
  (step.frames || []).forEach((f, d) => f.vars.forEach(([name, v]) => {
    if (typeof v === 'string' && v.length >= 2 && v.length <= 200) {
      const key = `${d}|${f.fn}|${name}`;
      const oid = `str|${key}`;
      heap[oid] = { k: 'list', chars: true, items: [...v], n: v.length, heap: false };
      strOid.set(key, oid);
    }
  }));
  return { heap, strOid };
}

// Everything the visualizer needs for step `index`.
export function buildStepView(steps, index, overrides = {}, calls = []) {
  const step = steps[index];
  const prev = index > 0 ? steps[index - 1] : null;
  const { heap, strOid } = withStrings(step);
  const prevHeap = prev ? withStrings(prev).heap : {};
  const frames = step.frames || [];
  const top = frames.length - 1;

  const before = new Map();
  (prev?.frames || []).forEach((f, d) =>
    f.vars.forEach(([n, v]) => before.set(`${d}|${f.fn}|${n}`, JSON.stringify(v))));

  const labels = {};   // object id -> names of variables pointing at it
  const intVars = [];  // [name, value] for integer variables, outermost frame first
  const vars = [];
  frames.forEach((f, d) =>
    f.vars.forEach(([name, value]) => {
      const key = `${d}|${f.fn}|${name}`;
      vars.push({ key, depth: d, fn: f.fn, name, value, innermost: d === top,
        changed: prev !== null && before.get(key) !== JSON.stringify(value) });
      const o = refOf(value) ?? strOid.get(key) ?? null;
      if (o !== null) addName(labels, o, name);
      if (typeof value === 'number' && Number.isInteger(value)) intVars.push([name, value]);
    }));

  const ptrs = {};  // array index -> cursor names
  const byKey = {}; // graph node id -> cursor names
  for (const [name, v] of intVars) {
    if (INDEX_NAMES.has(name)) addName(ptrs, v, name);
    if (INDEX_NAMES.has(name) || NODE_NAMES.has(name)) addName(byKey, String(v), name);
  }
  // Innermost frame wins when several frames define the same loop variable.
  const pick = (names) => {
    for (const n of names) {
      const hit = [...intVars].reverse().find(([m]) => m === n);
      if (hit) return hit[1];
    }
    return null;
  };
  const cell = { r: pick(ROW_NAMES), c: pick(COL_NAMES) };
  // Sliding window: cells between the left and right cursors.
  const lo = pick(['left', 'l']);
  const hi = pick(['right', 'r']);
  const win = lo !== null && hi !== null && lo <= hi ? { lo, hi } : null;

  // Node ids that a set or queue currently holds (drawn as "seen" on graphs).
  const seen = new Set();
  for (const { value } of vars) {
    const e = entryOf(value, heap);
    if (e && (e.k === 'set' || e.k === 'deque')) {
      for (const x of e.items) if (typeof x === 'number') seen.add(String(x));
    }
  }

  // Structures = containers referenced by variables. A structure already reachable from a
  // bigger one is drawn inside it, not as a separate card.
  const direct = [];
  for (const { key, value } of vars) {
    const o = refOf(value) ?? strOid.get(key) ?? null;
    const e = o === null ? null : heap[o];
    if (!e || !CONTAINERS.has(e.k) || direct.includes(o)) continue;
    if (e.k === 'obj' && !e.attrs.length) continue;
    direct.push(o);
  }
  const reached = new Map(direct.map((o) => [o, reach(o, heap)]));
  direct.sort((a, b) => reached.get(b).size - reached.get(a).size);
  const covered = new Set();
  const rootOids = [];
  for (const o of direct) {
    if (covered.has(o)) continue;
    rootOids.push(o);
    for (const x of reached.get(o)) covered.add(x);
  }
  const roots = rootOids.map((o) => {
    const entry = heap[o];
    const names = labels[o] || [];
    const key = names[0] || `#${o}`;
    const auto = kindOf(entry, heap);
    return { oid: o, entry, names, key, auto, kind: overrides[key] || auto };
  });

  // Subscript accesses made by the line that produced this step.
  const acc = step.acc || [];
  const access = {};   // container id -> { r: Set of keys read, w: Set of keys written }
  const note = (oid, k, key) => {
    const a = (access[oid] ??= { r: new Set(), w: new Set() });
    a[k === 'r' ? 'r' : 'w'].add(String(key));
  };
  for (const a of acc) {
    if (a.sv !== undefined) {
      for (const { key, value } of vars) {
        if (value === a.sv && strOid.has(key)) note(strOid.get(key), a.k, a.i);
      }
    } else if (a.c !== undefined) {
      note(a.c, a.k, a.i);
    }
  }
  // Integer variables holding an index the code just used (e.g. i in nums[i]).
  const idxNames = {};
  for (const a of acc) {
    if (typeof a.i === 'number') {
      for (const [name, v] of intVars) if (v === a.i) addName(idxNames, v, name);
    }
  }

  const ctx = { heap, prevHeap, labels, ptrs, byKey, seen, cell, win, access, idxNames };
  return { step, index, frames, vars, roots, ctx, tree: callTree(calls, index, step.call ?? null) };
}
