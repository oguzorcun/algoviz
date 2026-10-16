// App shell: sample picker, run button, two panels (code | visualization).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SAMPLES from './samples.json';
import CodePanel from './CodePanel.jsx';
import Viz from './Viz.jsx';
import { buildStepView } from './model.js';
import { TraceClient } from './tracer.js';
import { usePlayer } from './usePlayer.js';

const MAX_STEPS = 2000;
const cumulative = (steps) => {
  let acc = '';
  return steps.map((s) => (acc += s.out || ''));
};

export default function App() {
  const first = SAMPLES[0];
  const [sampleId, setSampleId] = useState(first.id);
  const [edit, setEdit] = useState(first.code);
  const [expr, setExpr] = useState(first.expr);
  const [editing, setEditing] = useState(false);
  const [trace, setTrace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('First run loads Python in the browser (about 10 s).');
  const [overrides, setOverrides] = useState({});
  const clientRef = useRef(null);
  if (!clientRef.current) clientRef.current = new TraceClient();

  const steps = trace ? trace.steps : [];
  const player = usePlayer(steps.length, trace);
  const index = Math.min(player.i, Math.max(0, steps.length - 1));
  const outs = useMemo(() => cumulative(steps), [trace]);
  const view = useMemo(
    () => (steps.length ? buildStepView(steps, index, overrides, trace.calls) : null),
    [trace, index, overrides]);

  async function runWith(code, e) {
    setBusy(true);
    setEditing(false);
    setStatus('Tracing…');
    try {
      const t = await clientRef.current.run(code, e, MAX_STEPS);
      setTrace(t);
      setStatus(t.error ? 'Stopped with an error'
        : `${t.steps.length} steps${t.truncated ? ` (capped at ${MAX_STEPS})` : ''}`);
    } catch (err) {
      setTrace(null);
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { runWith(first.code, first.expr); }, []);

  function pickSample(id) {
    const s = SAMPLES.find((x) => x.id === id);
    setSampleId(id);
    setEdit(s.code);
    setExpr(s.expr);
    setOverrides({});
    runWith(s.code, s.expr);
  }

  const setKind = (key, kind) => setOverrides((o) => {
    const n = { ...o };
    if (kind === 'auto') delete n[key];
    else n[key] = kind;
    return n;
  });

  useEffect(() => {
    const onKey = (e) => {
      if (editing || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') player.go(index + 1);
      else if (e.key === 'ArrowLeft') player.go(index - 1);
      else if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, index, player.go, player.toggle]);

  const err = trace?.error;
  const atEnd = steps.length === 0 || index === steps.length - 1;
  const shown = trace?.code ?? edit;
  const codeLine = view ? view.step.line : null;

  return (
    <div className="app">
      <header className="top">
        <strong className="brand">Code → Trace</strong>
        <select value={sampleId} onChange={(e) => pickSample(e.target.value)}>
          {SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <input className="expr" value={expr} spellCheck={false}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runWith(edit, expr)}
          placeholder="Call to trace, e.g. solve([1, 2, 3])" />
        <button className="primary" disabled={busy} onClick={() => runWith(edit, expr)}>
          {busy ? 'Tracing…' : 'Run'}
        </button>
        <span className="status">{status}</span>
      </header>
      {err && atEnd && (
        <div className="err">{err.msg}{err.line ? ` (line ${err.line})` : ''}</div>
      )}
      <main className="panels">
        <CodePanel edit={edit} setEdit={setEdit} editing={editing} setEditing={setEditing}
          shown={shown} line={codeLine} errorLine={err && atEnd ? err.line : null} />
        <Viz view={view} count={steps.length} lines={shown.split('\n')}
          outText={outs[index] ?? ''} player={player} onKind={setKind} />
      </main>
    </div>
  );
}
