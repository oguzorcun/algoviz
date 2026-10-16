import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
ns = {"__name__": "harness_test"}
exec(compile((ROOT / "src/harness.py").read_text(), "harness.py", "exec"), ns)
samples = json.loads((ROOT / "src/samples.json").read_text())
EXPECT = {"stairs": 5, "tree": 3, "graph": 4, "heap": 5, "two-pointer": [2, 4], "islands": 2,
          "reverse": [4, 3, 2, 1], "longest": 3, "two-sum": [0, 1], "product-except-self": [24, 12, 8, 6], "coin-change": 3, "container-water": 49}

def decode(res):
    """Turn the traced result into plain Python for comparison."""
    if not res["result"]:
        return None
    v, heap = res["result"]["v"], res["result"]["heap"]
    if not (isinstance(v, dict) and "$" in v):
        return v
    ent = heap[v["$"]]
    if ent["k"] == "list":
        return list(ent["items"])
    if ent["k"] == "lnode":
        vals = []
        while True:
            vals.append(ent["val"])
            nxt = ent["next"]
            if isinstance(nxt, dict) and "$" in nxt:
                ent = heap[nxt["$"]]
            else:
                return vals
    return v

out = ROOT / "test/out"; out.mkdir(parents=True, exist_ok=True)
failures = []
for s in samples:
    res = json.loads(ns["run"](s["code"], s["expr"], 2000))
    v = decode(res)
    print(f'{s["id"]:12} steps={len(res["steps"]):4} calls={len(res["calls"]):3} result={v!r} error={res["error"]}')
    if res["error"]:
        failures.append(s["id"])
    if s["id"] in EXPECT and v != EXPECT[s["id"]]:
        failures.append(f'{s["id"]} expected {EXPECT[s["id"]]} got {v}')
    (out / f'{s["id"]}.json').write_text(json.dumps(res))
if failures:
    print("FAILURES:", failures); sys.exit(1)
print("all samples ok")
