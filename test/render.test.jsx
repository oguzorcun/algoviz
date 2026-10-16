// Renders the visualizer to HTML for every sample at several steps.
// Catches runtime errors in the React components that the build cannot see.
import React from 'react';
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import Viz from '../src/Viz.jsx';
import { buildStepView } from '../src/model.js';

const root = process.cwd() + '/';
const ids = ['stairs', 'reverse', 'tree', 'graph', 'heap', 'two-pointer', 'islands', 'longest', 'two-sum', 'product-except-self', 'coin-change', 'container-water'];
const player = { i: 0, go() {}, toggle() {}, playing: false, speed: 1, setSpeed() {} };
let rendered = 0;
for (const id of ids) {
  const t = JSON.parse(fs.readFileSync(`${root}test/out/${id}.json`, 'utf8'));
  const picks = [0, Math.floor(t.steps.length / 2), t.steps.length - 1];
  for (const i of picks) {
    const view = buildStepView(t.steps, i, {}, t.calls);
    const html = renderToStaticMarkup(
      <Viz view={view} count={t.steps.length} lines={t.code ? t.code.split('\n') : []}
        outText={t.out} player={{ ...player, i }} onKind={() => {}} />);
    if (!html.includes('Variables')) throw new Error(`${id} step ${i}: panel missing`);
    rendered++;
  }
  // Also render every override kind on the first root, to exercise the fallbacks.
  const v = buildStepView(t.steps, t.steps.length - 1, {}, t.calls);
  for (const kind of ['array', 'grid', 'graph', 'tree', 'list', 'heap', 'map', 'set', 'object', 'queue']) {
    for (const r of v.roots) {
      const forced = { ...v, roots: [{ ...r, kind }] };
      renderToStaticMarkup(<Viz view={forced} count={t.steps.length} lines={[]} outText=""
        player={player} onKind={() => {}} />);
      rendered++;
    }
  }
  console.log(id.padEnd(12), 'rendered', picks.length, 'steps + fallback kinds');
}
// Highlights must appear on at least one step of the right sample.
const anyStep = (id, needle) => {
  const t = JSON.parse(fs.readFileSync(`${root}test/out/${id}.json`, 'utf8'));
  return t.steps.some((_, i) => renderToStaticMarkup(<Viz view={buildStepView(t.steps, i, {}, t.calls)}
    count={t.steps.length} lines={[]} outText="" player={{ ...player, i }} onKind={() => {}} />).includes(needle));
};
for (const [id, needle] of [['product-except-self', 'cell wr'], ['two-sum', 'cell rd'], ['coin-change', 'cell wr'], ['container-water', 'cell rd']]) {
  if (!anyStep(id, needle)) throw new Error(`${id}: no step shows ${needle}`);
  console.log(id.padEnd(20), 'highlight found:', needle);
}
console.log(`rendered ${rendered} views without errors`);

// Content checks: the right drawing appears for each sample.
import CodePanel from '../src/CodePanel.jsx';
const expectIn = {
  tree: ['class="node"'],
  graph: ['class="node', 'class="edge"'],
  heap: ['class="node"', 'class="cells"'],
  islands: ['<table class="grid"'],
  reverse: ['class="chain"'],
  'two-pointer': ['class="cells"'],
  longest: ['class="cell win"', 'left', 'right'],
};
for (const [id, needles] of Object.entries(expectIn)) {
  const t = JSON.parse(fs.readFileSync(`${root}test/out/${id}.json`, 'utf8'));
  const mid = Math.floor(t.steps.length / 2);
  const html = renderToStaticMarkup(<Viz view={buildStepView(t.steps, mid, {}, t.calls)}
    count={t.steps.length} lines={[]} outText="" player={{ ...player, i: mid }} onKind={() => {}} />);
  for (const n of needles) {
    if (!html.includes(n)) throw new Error(`${id}: expected ${n} in output`);
  }
  console.log(id.padEnd(12), 'content ok:', needles.join(', '));
}
const t = JSON.parse(fs.readFileSync(`${root}test/out/stairs.json`, 'utf8'));
const withCode = renderToStaticMarkup(<CodePanel edit="" setEdit={() => {}} editing={false}
  setEditing={() => {}} shown={t.code || 'x = 1'} line={2} errorLine={null} />);
if (!withCode.includes('hlbar')) throw new Error('code panel: highlight bar missing');
renderToStaticMarkup(<CodePanel edit="a" setEdit={() => {}} editing={true} setEditing={() => {}}
  shown="" line={null} errorLine={null} />);
console.log('code panel: highlight bar and edit mode render');
