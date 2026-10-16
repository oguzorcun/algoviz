# algoviz: code to trace

Paste Python code, choose a call to trace, and the app shows the code on the left and an
animated visualization on the right. Structures are drawn from what the objects are at
runtime (array, grid, graph, linked list, tree, heap, map, set, call tree), not from which
problem is loaded.

## Run

    npm install
    npm run dev        # or: npm run build

The first run downloads Python (Pyodide 0.26.4, about 10 MB) from the jsDelivr CDN.

## How it works

- `src/harness.py` runs the code under `sys.settrace`. Each executed line records a
  snapshot: locals of every user frame, the reachable heap (lists, dicts, linked and tree
  nodes, objects), printed output, and call/return events.
- `public/trace-worker.js` runs Pyodide in a Web Worker. A run that exceeds 20 s is
  stopped by terminating the worker.
- `src/model.js` classifies structures and builds the view for one step. It is pure logic
  and is tested with Node.
- `src/views.jsx` draws each structure type. `src/Viz.jsx` and `src/CodePanel.jsx` are the
  two panels.

## Heuristics (see the dropdown on each structure to override)

- A 2D list is a graph when it looks like an adjacency list (jagged rows of valid node
  ids). Rectangular lists are grids.
- A list passed to `heapq` is drawn as a heap from the first push onward.
- Pointer labels use common cursor names (`i`, `l`, `r`, `node`, `cur`, ...).

## Limits

- Python only. The step format is language-neutral, so another tracer could feed the same views.
- Heap snapshots are capped (800 objects, 64 items per container); the trace is capped at 2000 steps.
- User code runs in the browser sandbox, with no file or network access from Python.

## Tests

    npm test

Runs the harness under CPython and Pyodide, checks the view model on real traces, and
server-renders every view.
