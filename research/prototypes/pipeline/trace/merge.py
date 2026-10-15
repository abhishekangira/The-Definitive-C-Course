# merge.py native.json valgrind.json out.json
# Native pass = source of truth for values/addresses (glibc heap layout, real garbage).
# Valgrind pass = definedness (init/vbits) + memcheck errors. Steps must align 1:1.
import json, sys
nat, vg = (json.load(open(p)) for p in sys.argv[1:3])
ln = [s.get("line") for s in nat["steps"]]
lv = [s.get("line") for s in vg["steps"]]
if ln != lv:
    sys.exit("step sequences diverge (program behaviour depends on uninitialised data?) -- keep native only")
for a, b in zip(nat["steps"], vg["steps"]):
    if "errors" in b:
        a["errors"] = b["errors"]
    for fa, fb in zip(a.get("stack", []), b.get("stack", [])):
        byname = {v["name"]: v for v in fb["vars"]}
        for v in fa["vars"]:
            w = byname.get(v["name"], {})
            for k in ("init", "vbits"):
                if k in w:
                    v[k] = w[k]
    hb = {h["id"]: h for h in b.get("heap", [])}
    for h in a.get("heap", []):
        for k in ("init", "vbits"):
            if k in hb.get(h["id"], {}):
                h[k] = hb[h["id"]][k]
json.dump(nat, open(sys.argv[3], "w"), separators=(",", ":"))
print("merged", len(nat["steps"]), "steps")
