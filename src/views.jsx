// React components that draw each structure type. Data comes from model.js.
import React from 'react';
import { entryOf, refOf, isRef, isRepr, summary, adjacencyOf, layoutTree, layoutHeap } from './model.js';

export const KINDS = ['array', 'queue', 'grid', 'graph', 'list', 'tree', 'heap', 'map', 'set', 'object'];
const cls = (...xs) => xs.filter(Boolean).join(' ');

// Cursor names for a cell: names of index variables, plus names of variables that
// held an index the code actually read or wrote on this container during the step.
const cursorNames = (ctx, oid, i) => {
  const a = ctx.access[oid];
  const hit = Boolean(a && (a.r.has(String(i)) || a.w.has(String(i))));
  return [...new Set([...(ctx.ptrs[i] || []), ...(hit ? (ctx.idxNames[i] || []) : [])])];
};
// Read = blue outline, written = amber fill (a cell can be both).
const accClass = (ctx, oid, key) => {
  const a = oid == null ? null : ctx.access[oid];
  if (!a) return '';
  return [a.w.has(String(key)) && 'wr', a.r.has(String(key)) && 'rd'].filter(Boolean).join(' ');
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const txt = (v, ctx) => {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'object') return summary(v, ctx.heap);
  return String(v);
};

// Cursor labels above a cell.
const Names = ({ names }) => <div className="ptr">{names && names.length ? names.join(' ') : ''}</div>;

// A single value: primitives inline, small containers nested, deeper ones as text.
export function Val({ v, ctx, depth = 0 }) {
  if (v === null || v === undefined) return <span className="mu">None</span>;
  if (typeof v === 'string') return <span>'{v}'</span>;
  if (typeof v !== 'object') return <span>{String(v)}</span>;
  if (isRepr(v)) return <span className="mu">{v.repr}</span>;
  const e = entryOf(v, ctx.heap);
  if (!e) return <span className="mu">…</span>;
  if (depth < 2 && e.k === 'lnode') return <Chain head={refOf(v)} ctx={ctx} />;
  if (depth < 2 && (e.k === 'list' || e.k === 'tuple')) {
    return <Cells oid={refOf(v)} entry={e} ctx={ctx} depth={depth + 1} nested />;
  }
  return <span className="mu">{summary(v, ctx.heap)}</span>;
}

// Array-like: a row of cells with index and cursor labels.
const inWindow = (entry, ctx, i) =>
  Boolean(entry.chars && ctx.win && i >= ctx.win.lo && i <= ctx.win.hi);
export function Cells({ oid, entry, ctx, depth = 0, nested = false }) {
  if (!entry.items.length) return <span className="mu">empty</span>;
  const prev = ctx.prevHeap[oid];
  return (
    <div className="cells">
      {entry.items.map((x, i) => {
        const changed = Boolean(prev?.items) && !same(prev.items[i], x);
        return (
          <div className="cw" key={i}>
            <div className={cls('cell', changed && 'chg', !nested && inWindow(entry, ctx, i) && 'win', accClass(ctx, oid, i))}>
              {entry.chars ? x : <Val v={x} ctx={ctx} depth={depth} />}
            </div>
            <div className="idx">{i}</div>
            {!nested && <Names names={cursorNames(ctx, oid, i)} />}
          </div>
        );
      })}
      {entry.n > entry.items.length && <span className="mu">+{entry.n - entry.items.length}</span>}
    </div>
  );
}

// Linked list: nodes joined by arrows, cursor labels above, cycles shown as a back-reference.
export function Chain({ head, ctx }) {
  const parts = [];
  const seen = new Map();
  let cur = { $: head };
  for (;;) {
    const o = refOf(cur);
    const e = entryOf(cur, ctx.heap);
    if (!e || e.k !== 'lnode') {
      parts.push(<span key={'x' + parts.length} className="mu">…</span>);
      break;
    }
    if (seen.has(o)) {
      parts.push(<span key={'b' + parts.length} className="back">↺ node {seen.get(o)}</span>);
      break;
    }
    const idx = seen.size;
    seen.set(o, idx);
    const before = ctx.prevHeap[o];
    parts.push(
      <div className="lnode" key={'n' + idx}>
        <Names names={ctx.labels[o]} />
        <div className={cls('cell', before && !same(before.val, e.val) && 'chg')}>
          <Val v={e.val} ctx={ctx} depth={2} />
        </div>
      </div>
    );
    if (!isRef(e.next)) {
      parts.push(<span key="end" className="mu">None</span>);
      break;
    }
    parts.push(<span key={'a' + idx} className="arrow">→</span>);
    cur = e.next;
  }
  return <div className="chain">{parts}</div>;
}

// Binary tree drawn top-down, in-order horizontally.
export function Tree({ root, ctx }) {
  const { nodes, edges } = layoutTree(root, ctx.heap);
  if (!nodes.length) return <span className="mu">empty</span>;
  const X = 46, Y = 58, R = 17, top = 34, left = 24;
  const x = (n) => left + n.x * X;
  const y = (n) => top + n.y * Y;
  const at = new Map(nodes.map((n) => [n.oid, n]));
  const w = left * 2 + Math.max(...nodes.map((n) => n.x)) * X + X;
  const h = top + Math.max(...nodes.map((n) => n.y)) * Y + R + 12;
  return (
    <svg className="svg" width={w} height={h}>
      {edges.map(([a, b]) => at.has(a) && at.has(b) && (
        <line key={a + '-' + b} className="edge"
          x1={x(at.get(a))} y1={y(at.get(a))} x2={x(at.get(b))} y2={y(at.get(b))} />
      ))}
      {nodes.map((n) => {
        const names = ctx.labels[n.oid];
        return (
          <g key={n.oid} className={cls(names && 'hit')}>
            <circle className="node" cx={x(n)} cy={y(n)} r={R} />
            <text textAnchor="middle" x={x(n)} y={y(n) + 4}>{txt(n.val, ctx)}</text>
            {names && <text className="ptxt" textAnchor="middle" x={x(n)} y={y(n) - R - 4}>{names.join(' ')}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Graph: nodes on a circle, edges between neighbours. Cursor nodes are labelled,
// nodes held by a set or queue are filled.
export function Graph({ adj, ctx, oid }) {
  const n = adj.ids.length;
  const W = 300, H = 280, R = Math.max(40, 120 - n * 3);
  const pos = adj.ids.map((_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [W / 2 + R * Math.cos(a), H / 2 + R * Math.sin(a)];
  });
  const edges = [];
  const drawn = new Set();
  adj.nbrs.forEach((ns, u) => ns.forEach((v) => {
    const k = Math.min(u, v) + '-' + Math.max(u, v);
    if (!drawn.has(k)) { drawn.add(k); edges.push([u, v]); }
  }));
  return (
    <svg className="svg" width={W} height={H}>
      {edges.map(([u, v]) => (
        <line key={u + '-' + v} className="edge"
          x1={pos[u][0]} y1={pos[u][1]} x2={pos[v][0]} y2={pos[v][1]} />
      ))}
      {adj.ids.map((id, i) => {
        const key = String(id);
        const names = ctx.byKey[key];
        const [x, y] = pos[i];
        return (
          <g key={key}>
            <circle className={cls('node', ctx.seen.has(key) && 'seen', names && 'cur', accClass(ctx, oid, id))} cx={x} cy={y} r={16} />
            <text textAnchor="middle" x={x} y={y + 4}>{key}</text>
            {names && <text className="ptxt" textAnchor="middle" x={x} y={y - 22}>{names.join(' ')}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// 2D list: a table. Changed cells are green; the cell a row/col cursor points at is outlined.
export function Grid({ oid, entry, ctx }) {
  const prev = ctx.prevHeap[oid];
  return (
    <table className="grid">
      <tbody>
        {entry.items.map((x, r) => {
          const row = entryOf(x, ctx.heap);
          const rowOid = refOf(x);
          return (
            <tr key={r}>
              <th className={accClass(ctx, oid, r)}>{r}</th>
              {(row?.items || []).map((cellVal, c) => {
                const prow = prev?.items?.[r] !== undefined ? entryOf(prev.items[r], ctx.heap) : null;
                const changed = Boolean(prow?.items) && !same(prow.items[c], cellVal);
                const here = ctx.cell.r === r && ctx.cell.c === c;
                return (
                  <td key={c} className={cls(changed && 'chg', here && 'cur', accClass(ctx, rowOid, c))}>
                    {typeof cellVal === 'object' ? <Val v={cellVal} ctx={ctx} depth={2} /> : String(cellVal)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Heap as a complete binary tree over the array indices.
export function HeapTree({ items, ctx }) {
  const n = Math.min(items.length, 64);
  const { nodes, edges, depth } = layoutHeap(n);
  const W = 300, Y = 46, R = 15;
  const x = (nd) => 18 + (W - 36) * nd.pos;
  const y = (nd) => 18 + nd.depth * Y;
  return (
    <svg className="svg" width={W} height={depth * Y + 40}>
      {edges.map(([a, b]) => (
        <line key={b} className="edge" x1={x(nodes[a])} y1={y(nodes[a])} x2={x(nodes[b])} y2={y(nodes[b])} />
      ))}
      {nodes.map((nd) => (
        <g key={nd.i}>
          <circle className="node" cx={x(nd)} cy={y(nd)} r={R} />
          <text textAnchor="middle" x={x(nd)} y={y(nd) + 4}>{txt(items[nd.i], ctx)}</text>
        </g>
      ))}
    </svg>
  );
}

function MapView({ oid, entry, ctx }) {
  const prev = ctx.prevHeap[oid];
  return (
    <table className="kv">
      <tbody>
        {entry.items.map(([k, v], i) => {
          const old = prev?.items?.find(([pk]) => same(pk, k));
          const changed = Boolean(prev) && (!old || !same(old[1], v));
          return (
            <tr key={i} className={cls(changed && 'chg', accClass(ctx, oid, k))}>
              <td><Val v={k} ctx={ctx} depth={1} /></td>
              <td><Val v={v} ctx={ctx} depth={1} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SetView({ entry, ctx }) {
  if (!entry.items.length) return <span className="mu">empty set</span>;
  return (
    <div className="chips">
      {entry.items.map((x, i) => <span key={i} className="chip"><Val v={x} ctx={ctx} depth={1} /></span>)}
    </div>
  );
}

function ObjectView({ entry, ctx }) {
  return (
    <table className="kv">
      <caption className="mu">{entry.cls}</caption>
      <tbody>
        {entry.attrs.map(([k, v]) => (
          <tr key={k}><td>{k}</td><td><Val v={v} ctx={ctx} depth={1} /></td></tr>
        ))}
      </tbody>
    </table>
  );
}

// Picks the drawing for a structure's kind. Falls back to a generic view when the
// requested kind does not fit the data (e.g. "tree" chosen for a list).
export function Body({ root, ctx }) {
  const { oid, entry: e, kind } = root;
  const fallback = (note) => (
    <>
      <div className="note">{note}</div>
      <Val v={{ $: oid }} ctx={ctx} depth={0} />
    </>
  );
  switch (kind) {
    case 'grid':
      return e.k === 'list' && e.items.every((x) => entryOf(x, ctx.heap)?.k === 'list')
        ? <Grid oid={oid} entry={e} ctx={ctx} />
        : fallback('Not a 2D list; showing it as-is.');
    case 'graph': {
      const adj = adjacencyOf(e, ctx.heap);
      return adj ? <Graph adj={adj} ctx={ctx} oid={oid} /> : fallback('Not an adjacency list (rows of valid node ids).');
    }
    case 'tree':
      return e.k === 'tnode' ? <Tree root={oid} ctx={ctx} /> : fallback('Not a tree node.');
    case 'list':
      return e.k === 'lnode' ? <Chain head={oid} ctx={ctx} /> : fallback('Not a linked-list node.');
    case 'heap':
      return e.k === 'list'
        ? <><Cells oid={oid} entry={e} ctx={ctx} /><HeapTree items={e.items} ctx={ctx} /></>
        : fallback('Not a list.');
    case 'map':
      return e.k === 'dict' ? <MapView oid={oid} entry={e} ctx={ctx} /> : fallback('Not a dict.');
    case 'set':
      return e.k === 'set' ? <SetView entry={e} ctx={ctx} /> : fallback('Not a set.');
    case 'object':
      return e.k === 'obj' ? <ObjectView entry={e} ctx={ctx} /> : fallback('Not an object.');
    default: // array, queue
      if (e.k === 'list' || e.k === 'tuple' || e.k === 'deque') {
        return <Cells oid={oid} entry={e} ctx={ctx} />;
      }
      return <Val v={{ $: oid }} ctx={ctx} depth={0} />;
  }
}

// Recursion / call tree. Path to the current call is highlighted; finished calls show their result.
export function CallTreeSvg({ tree }) {
  const X = 94, Y = 56, W = 84, H = 26, pad = 10;
  const maxX = Math.max(...tree.nodes.map((n) => n.x));
  const maxY = Math.max(...tree.nodes.map((n) => n.y));
  const px = (n) => pad + n.x * X;
  const py = (n) => pad + n.y * Y;
  const at = new Map(tree.nodes.map((n) => [n.id, n]));
  const clip = (s) => (s.length > 14 ? s.slice(0, 13) + '…' : s);
  return (
    <svg className="svg" width={pad * 2 + maxX * X + W} height={pad * 2 + maxY * Y + H}>
      {tree.edges.map(([a, b]) => (
        <line key={a + '-' + b} className="edge"
          x1={px(at.get(a)) + W / 2} y1={py(at.get(a)) + H} x2={px(at.get(b)) + W / 2} y2={py(at.get(b))} />
      ))}
      {tree.nodes.map((n) => (
        <g key={n.id}>
          <rect className={cls('cnode', n.active && 'active', n.onPath && 'path', n.done && 'done')}
            x={px(n)} y={py(n)} width={W} height={H} rx={6} />
          <text x={px(n) + W / 2} y={py(n) + 17} textAnchor="middle">{clip(n.text)}</text>
        </g>
      ))}
    </svg>
  );
}
