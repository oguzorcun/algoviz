"""
Trace harness. Runs user code and records one snapshot per executed line.
Runs in the browser under Pyodide and under plain CPython (tests).
Entry point: run(code, expr, max_steps) -> JSON string.
"""
import ast
import sys
import io
import json
import heapq
import types
import collections
import traceback
from typing import List, Optional, Dict, Set, Tuple, Deque

USER = "<user>"          # only frames compiled under this filename are traced
MAX_STEPS = 2000
MAX_ITEMS = 64           # items kept per container
MAX_OBJECTS = 800        # heap objects kept per snapshot
MAX_DEPTH = 200
MAX_ACC = 32         # subscript accesses kept per line
_NO_VALUE = object()
_CALLABLES = (types.FunctionType, types.BuiltinFunctionType, types.MethodType,
              types.ModuleType, type)
PRELUDE = set()          # names injected by the harness; hidden from module vars
HEAP_LISTS = {}          # id -> list passed to heapq, so it is drawn as a heap


class _Stop(Exception):
    """Raised inside the tracer to stop a run that hit the step cap."""


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def build_list(vals):
    head = None
    for v in reversed(vals):
        head = ListNode(v, head)
    return head


def build_tree(vals):
    """LeetCode level-order list (None for missing children) -> TreeNode."""
    if not vals or vals[0] is None:
        return None
    root = TreeNode(vals[0])
    q = collections.deque([root])
    i = 1
    while q and i < len(vals):
        node = q.popleft()
        if i < len(vals) and vals[i] is not None:
            node.left = TreeNode(vals[i])
            q.append(node.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            node.right = TreeNode(vals[i])
            q.append(node.right)
        i += 1
    return root


def _watch_heapq(name):
    orig = getattr(heapq, name)

    def wrapper(h, *args):
        if isinstance(h, list):
            HEAP_LISTS[id(h)] = h
        return orig(h, *args)

    wrapper.__name__ = name
    setattr(heapq, name, wrapper)


for _name in ("heappush", "heappop", "heapify", "heapreplace", "heappushpop"):
    _watch_heapq(_name)


def _safe_repr(v, n=24):
    try:
        return repr(v)[:n]
    except Exception:
        return "<?>"


def _is_lnode(v):
    return hasattr(v, "val") and hasattr(v, "next") and not hasattr(v, "left")


def _is_tnode(v):
    return hasattr(v, "val") and hasattr(v, "left") and hasattr(v, "right")


def _short(v):
    """One-line summary for call-tree labels and return values."""
    if isinstance(v, (list, tuple, set, frozenset, dict, collections.deque)):
        return f"{type(v).__name__}[{len(v)}]"
    if _is_lnode(v) or _is_tnode(v):
        return f"Node({_short(v.val)})"
    if v is None or isinstance(v, (bool, int, float)):
        return repr(v)
    if isinstance(v, str):
        return repr(v)[:24]
    if hasattr(v, "__dict__") and not isinstance(v, _CALLABLES):
        return type(v).__name__ + "()"
    return _safe_repr(v)


class Ser:
    """Turns Python values into JSON-friendly data. Containers go into self.objs by id."""

    def __init__(self):
        self.objs = {}
        self.truncated = False

    def val(self, v, depth=0):
        if v is None or isinstance(v, bool):
            return v
        if isinstance(v, int):
            return v if -(2 ** 53) < v < 2 ** 53 else str(v)
        if isinstance(v, float):
            return v if v == v and abs(v) != float("inf") else repr(v)
        if isinstance(v, str):
            return v if len(v) <= 200 else v[:200] + "…"
        if isinstance(v, _CALLABLES):
            return {"repr": "<" + type(v).__name__ + ">"}
        return {"$": self.obj(v, depth)}

    def _seq(self, items, depth):
        items = list(items)
        return {"items": [self.val(x, depth) for x in items[:MAX_ITEMS]], "n": len(items)}

    def obj(self, v, depth):
        oid = str(id(v))
        if oid in self.objs:
            return oid
        if len(self.objs) >= MAX_OBJECTS or depth > MAX_DEPTH:
            self.truncated = True
            return oid
        e = {}
        self.objs[oid] = e          # placeholder first, so cycles terminate
        d = depth + 1
        if isinstance(v, list):
            e.update(k="list", heap=id(v) in HEAP_LISTS, **self._seq(v, d))
        elif isinstance(v, tuple):
            e.update(k="tuple", **self._seq(v, d))
        elif isinstance(v, collections.deque):
            e.update(k="deque", **self._seq(v, d))
        elif isinstance(v, (set, frozenset)):
            e.update(k="set", **self._seq(v, d))
        elif isinstance(v, dict):
            pairs = list(v.items())
            e.update(k="dict", n=len(pairs),
                     items=[[self.val(a, d), self.val(b, d)] for a, b in pairs[:MAX_ITEMS]])
        elif _is_lnode(v):
            e.update(k="lnode", val=self.val(v.val, d), next=self.val(v.next, d))
        elif _is_tnode(v):
            e.update(k="tnode", val=self.val(v.val, d),
                     left=self.val(v.left, d), right=self.val(v.right, d))
        elif hasattr(v, "__dict__"):
            attrs = [[k, self.val(x, d)] for k, x in vars(v).items() if not k.startswith("_")]
            e.update(k="obj", cls=type(v).__name__, attrs=attrs[:MAX_ITEMS])
        else:
            e.update(k="repr", text=_safe_repr(v, 120))
        return oid


def _frames(frame, ser):
    """Locals of every user frame, outermost first."""
    out = []
    f = frame
    while f is not None and f.f_code.co_filename == USER:
        in_module = f.f_code.co_name == "<module>"
        rows = []
        for name, value in f.f_locals.items():
            if name.startswith("__") or isinstance(value, _CALLABLES):
                continue
            if in_module and name in PRELUDE:
                continue
            rows.append([name, ser.val(value)])
        out.append({"fn": f.f_code.co_name, "line": f.f_lineno, "vars": rows})
        f = f.f_back
    out.reverse()
    return out


# ---- Subscript access tracking -------------------------------------------------
# The user's code is rewritten so every x[i] read goes through __get__ and every
# x[i] = v write goes through __set__. Each access is logged with its container id
# and index, so the visualizer can highlight the cells the code really touches.
_ACC = []
_LOGGABLE = (list, tuple, dict, str, collections.deque)


def _acc_key(i):
    if i is None or isinstance(i, (bool, int, str)):
        return i
    return _safe_repr(i, 40)


def _log(x, i, kind):
    if len(_ACC) >= MAX_ACC:
        return
    rec = {"k": kind, "i": _acc_key(i)}
    if isinstance(x, str):
        if len(x) > 200:
            return
        rec["sv"] = x                 # strings are values; matched by content
    else:
        rec["c"] = str(id(x))
    _ACC.append(rec)


def _drain():
    out = list(_ACC)
    del _ACC[:]
    return out


def __get__(x, i):
    v = x[i]
    if isinstance(x, _LOGGABLE):
        _log(x, i, "r")
    return v


def __set__(x, i, v):
    x[i] = v
    if isinstance(x, (list, dict, collections.deque)):
        _log(x, i, "w")


def __unpack__(v, n):
    t = tuple(v)
    if len(t) != n:
        raise ValueError("wrong number of values to unpack (expected %d, got %d)" % (n, len(t)))
    return t


class _Instrument(ast.NodeTransformer):
    """Rewrites subscript reads and writes into __get__/__set__ calls. Line numbers are kept."""

    def __init__(self):
        self.n = 0

    def _tmp(self):
        self.n += 1
        return "__t%d__" % self.n          # dunder names are hidden from variable views

    @staticmethod
    def _plain(e):
        return isinstance(e, ast.Subscript) and not isinstance(e.slice, ast.Slice)

    @staticmethod
    def _call(fn, args, node):
        call = ast.Call(func=ast.Name(id=fn, ctx=ast.Load()), args=args, keywords=[])
        return ast.copy_location(call, node)

    @staticmethod
    def _name(name, node, store=False):
        n = ast.Name(id=name, ctx=ast.Store() if store else ast.Load())
        return ast.copy_location(n, node)

    def visit_Subscript(self, node):
        self.generic_visit(node)
        if isinstance(node.ctx, ast.Load) and not isinstance(node.slice, ast.Slice):
            return self._call("__get__", [node.value, node.slice], node)
        return node

    def visit_Assign(self, node):
        if len(node.targets) != 1:
            return self.generic_visit(node)
        tgt = node.targets[0]
        if self._plain(tgt):
            # x[i] = v  ->  t = v; __set__(x, i, t)   (value first, as in Python)
            t = self._tmp()
            first = ast.Assign(targets=[self._name(t, node, True)], value=self.visit(node.value))
            base, idx = self.visit(tgt.value), self.visit(tgt.slice)
            second = ast.Expr(value=self._call("__set__", [base, idx, self._name(t, node)], node))
            return [ast.copy_location(first, node), ast.copy_location(second, node)]
        if (isinstance(tgt, (ast.Tuple, ast.List)) and any(self._plain(e) for e in tgt.elts)
                and not any(isinstance(e, ast.Starred) for e in tgt.elts)):
            # a[i], a[j] = x, y  ->  t = __unpack__(value, 2); __set__(a, i, t[0]); ...
            n = len(tgt.elts)
            t = self._tmp()
            unpack = self._call("__unpack__", [self.visit(node.value), ast.Constant(value=n)], node)
            stmts = [ast.copy_location(ast.Assign(targets=[self._name(t, node, True)], value=unpack), node)]
            for k, e in enumerate(tgt.elts):
                item = ast.copy_location(ast.Subscript(
                    value=self._name(t, node), slice=ast.Constant(value=k), ctx=ast.Load()), node)
                if self._plain(e):
                    base, idx = self.visit(e.value), self.visit(e.slice)
                    stmts.append(ast.copy_location(ast.Expr(
                        value=self._call("__set__", [base, idx, item], node)), node))
                else:
                    stmts.append(ast.copy_location(ast.Assign(targets=[e], value=item), node))
            return stmts
        return self.generic_visit(node)

    def visit_AugAssign(self, node):
        tgt = node.target
        if not self._plain(tgt):
            return self.generic_visit(node)
        # x[i] += v  ->  b = x; k = i; __set__(b, k, __get__(b, k) + v)
        b, k = self._tmp(), self._tmp()
        stmts = [
            ast.copy_location(ast.Assign(targets=[self._name(b, node, True)], value=self.visit(tgt.value)), node),
            ast.copy_location(ast.Assign(targets=[self._name(k, node, True)], value=self.visit(tgt.slice)), node),
        ]
        read = self._call("__get__", [self._name(b, node), self._name(k, node)], node)
        new = ast.copy_location(ast.BinOp(left=read, op=node.op, right=self.visit(node.value)), node)
        stmts.append(ast.copy_location(ast.Expr(value=self._call(
            "__set__", [self._name(b, node), self._name(k, node), new], node)), node))
        return stmts


class Tracer:
    def __init__(self, buf, max_steps):
        self.buf = buf
        self.max = max_steps
        self.steps = []
        self.calls = []          # one entry per user function call
        self.frame_call = {}     # id(frame) -> index into self.calls
        self.unwinding = set()   # frames propagating an exception
        self.last_out = 0
        self.truncated = False

    def global_trace(self, frame, event, arg):
        if frame.f_code.co_filename != USER:
            return None
        if event == "call":
            try:
                self._enter(frame)
            except Exception:
                pass
        return self.local_trace

    def _enter(self, frame):
        code = frame.f_code
        if code.co_name == "<module>":
            return
        caller = frame.f_back
        parent = self.frame_call.get(id(caller)) if caller is not None else None
        args = [[n, _short(frame.f_locals[n])] for n in code.co_varnames[:code.co_argcount]
                if n in frame.f_locals and n not in ("self", "cls")]
        self.calls.append({"fn": code.co_name, "parent": parent, "start": len(self.steps),
                           "args": args, "retStep": None, "ret": None})
        self.frame_call[id(frame)] = len(self.calls) - 1

    def local_trace(self, frame, event, arg):
        key = id(frame)
        if event == "line":
            self.unwinding.discard(key)
            self._record(frame, "line", _NO_VALUE)
        elif event == "exception":
            self.unwinding.add(key)
        elif event == "return":
            if key in self.unwinding:
                self.unwinding.discard(key)
                self.frame_call.pop(key, None)
            else:
                self._record(frame, "return", arg)
                cid = self.frame_call.pop(key, None)
                if cid is not None:
                    self.calls[cid]["retStep"] = len(self.steps) - 1
                    self.calls[cid]["ret"] = _short(arg)
        return self.local_trace

    def _record(self, frame, event, retval):
        if len(self.steps) >= self.max:
            self.truncated = True
            raise _Stop()
        if self.steps:
            self.steps[-1]["acc"] = _drain()   # accesses made by the previous line
        try:
            ser = Ser()
            step = {"ev": event, "line": frame.f_lineno,
                    "call": self.frame_call.get(id(frame)), "frames": _frames(frame, ser)}
            if retval is not _NO_VALUE:
                step["ret"] = ser.val(retval)
            out = self.buf.getvalue()
            step["out"] = out[self.last_out:]
            self.last_out = len(out)
            if ser.truncated:
                step["trunc"] = True
            step["heap"] = ser.objs
        except _Stop:
            raise
        except Exception as exc:  # a snapshot failure must never break user code
            step = {"ev": event, "line": frame.f_lineno, "call": None, "frames": [],
                    "heap": {}, "out": "", "error": repr(exc)[:120]}
        self.steps.append(step)


def _user_line(e):
    lines = [fs.lineno for fs in traceback.extract_tb(e.__traceback__) if fs.filename == USER]
    return lines[-1] if lines else None


def _make_globals():
    g = {"__name__": "__user__", "__builtins__": __builtins__,
         "ListNode": ListNode, "TreeNode": TreeNode,
         "build_list": build_list, "build_tree": build_tree,
         "heapq": heapq, "collections": collections,
         "__get__": __get__, "__set__": __set__, "__unpack__": __unpack__,
         "List": List, "Optional": Optional, "Dict": Dict,
         "Set": Set, "Tuple": Tuple, "Deque": Deque}
    PRELUDE.clear()
    PRELUDE.update(g)
    return g


def run(code, expr, max_steps=MAX_STEPS):
    HEAP_LISTS.clear()
    del _ACC[:]
    sys.setrecursionlimit(6000)
    buf = io.StringIO()
    g = _make_globals()
    tracer = Tracer(buf, int(max_steps))
    res = {"steps": [], "calls": [], "error": None, "truncated": False,
           "out": "", "result": None}
    old_stdout = sys.stdout
    sys.stdout = buf
    try:
        try:
            tree = ast.fix_missing_locations(_Instrument().visit(ast.parse(code, USER, "exec")))
            exec(compile(tree, USER, "exec"), g)        # definitions run untraced
            etree = ast.fix_missing_locations(_Instrument().visit(ast.parse(expr, USER, "eval")))
            body = compile(etree, USER, "eval")
            sys.settrace(tracer.global_trace)
            try:
                value = eval(body, g)
            finally:
                sys.settrace(None)
            ser = Ser()
            res["result"] = {"v": ser.val(value), "heap": ser.objs}
        except _Stop:
            pass
        except SyntaxError as e:
            res["error"] = {"msg": f"SyntaxError: {e.msg}", "line": e.lineno}
        except BaseException as e:
            res["error"] = {"msg": f"{type(e).__name__}: {e}", "line": _user_line(e)}
    finally:
        sys.settrace(None)
        if tracer.steps:
            tracer.steps[-1]["acc"] = _drain()
        sys.stdout = old_stdout
    res["steps"] = tracer.steps
    res["calls"] = tracer.calls
    res["truncated"] = tracer.truncated
    res["out"] = buf.getvalue()
    return json.dumps(res)
