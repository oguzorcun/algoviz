// Left panel: the code. In view mode a bar marks the line being executed.
import React from 'react';

const LH = 22; // line height in px, must match .cl in styles.css
const cls = (...xs) => xs.filter(Boolean).join(' ');

export default function CodePanel({ edit, setEdit, editing, setEditing, shown, line, errorLine }) {
  if (editing) {
    return (
      <div className="card">
        <div className="card-head">
          <span className="label">Code</span>
          <button className="primary" onClick={() => setEditing(false)}>Done</button>
        </div>
        <textarea className="editor" spellCheck={false} value={edit}
          onChange={(e) => setEdit(e.target.value)} />
      </div>
    );
  }
  const lines = shown.split('\n');
  return (
    <div className="card">
      <div className="card-head">
        <span className="label">Code</span>
        <button onClick={() => { setEdit(shown); setEditing(true); }}>Edit</button>
      </div>
      <div className="codebox">
        <div className="cb-in">
          {line != null && <div className="hlbar" style={{ top: (line - 1) * LH }} />}
          {errorLine != null && <div className="errbar" style={{ top: (errorLine - 1) * LH }} />}
          {lines.map((t, i) => (
            <div key={i} className={cls('cl', line === i + 1 && 'on')}>
              <span className="ln">{i + 1}</span>
              <span className="tx">{t || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
