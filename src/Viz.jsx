// Right panel: playback, structures, call tree, variables, call stack and output.
import React from 'react';
import { summary } from './model.js';
import { Body, CallTreeSvg, KINDS } from './views.jsx';

const cls = (...xs) => xs.filter(Boolean).join(' ');

export default function Viz({ view, count, lines, outText, player, onKind }) {
  if (!view) return <div className="card mu">Run the code to see its trace here.</div>;
  const { step, frames, roots, ctx, tree, index } = view;
  const top = frames[frames.length - 1];
  const desc = step.ev === 'return' && top
    ? `${top.fn} returns ${summary(step.ret, ctx.heap)}`
    : `Line ${step.line}: ${(lines[step.line - 1] || '').trim()}`;
  return (
    <div className="viz">
      <div className="card controls">
        <button disabled={index === 0} onClick={() => player.go(0)}>⏮</button>
        <button disabled={index === 0} onClick={() => player.go(index - 1)}>◀</button>
        <button className="primary" onClick={player.toggle}>{player.playing ? 'Pause' : 'Play'}</button>
        <button disabled={index >= count - 1} onClick={() => player.go(index + 1)}>▶</button>
        <button disabled={index >= count - 1} onClick={() => player.go(count - 1)}>⏭</button>
        {[0.5, 1, 2].map((s) => (
          <button key={s} className={cls(player.speed === s && 'on')} onClick={() => player.setSpeed(s)}>{s}x</button>
        ))}
        <div className="bar" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          player.go(Math.round(((e.clientX - r.left) / r.width) * (count - 1)));
        }}>
          <div className="fill" style={{ width: `${count > 1 ? (index / (count - 1)) * 100 : 100}%` }} />
        </div>
        <span className="mu">Step {index + 1} / {count}</span>
      </div>
      <div className="card desc">
        {desc}
        <div className="mu legend">blue outline: read · amber: written · green: changed · labels: index variables</div>
      </div>
      <div className="structs">
        {roots.map((root) => (
          <div className="card" key={root.oid}>
            <div className="card-head">
              <span className="label">{root.names.join(', ') || root.kind}</span>
              <select value={root.kind === root.auto ? 'auto' : root.kind}
                onChange={(e) => onKind(root.key, e.target.value)}>
                <option value="auto">auto: {root.auto}</option>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <Body root={root} ctx={ctx} />
          </div>
        ))}
        {tree && (
          <div className="card">
            <div className="card-head"><span className="label">Call tree</span></div>
            <div className="scroll"><CallTreeSvg tree={tree} /></div>
          </div>
        )}
      </div>
      {!roots.length && !tree && <div className="card mu">No containers in scope yet; see Variables.</div>}
      <div className="bottom">
        <Vars view={view} />
        <Stack frames={frames} />
        <div className="card">
          <div className="label">Output</div>
          <pre className="out">{outText || '(none yet)'}</pre>
        </div>
      </div>
    </div>
  );
}

function Vars({ view }) {
  const { vars, ctx } = view;
  return (
    <div className="card">
      <div className="label">Variables</div>
      {vars.length ? (
        <table className="kv">
          <tbody>
            {vars.map((v) => (
              <tr key={v.key} className={cls(v.changed && 'chg')}>
                <td>{v.name}</td>
                <td className="mu">{v.innermost ? '' : v.fn}</td>
                <td>{summary(v.value, ctx.heap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <span className="mu">none</span>}
    </div>
  );
}

function Stack({ frames }) {
  return (
    <div className="card">
      <div className="label">Fnc Call stack</div>
      {frames.slice().reverse().map((f, i) => (
        <div key={i} className={cls('frame', i === 0 && 'top')}>{f.fn} · line {f.line}</div>
      ))}
    </div>
  );
}
