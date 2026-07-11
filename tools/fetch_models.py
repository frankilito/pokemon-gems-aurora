#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 151 只初代宝可梦 GLB 模型(regular + 可用 shiny) from Pokemon-3D-api/assets"""
import json, os, sys, urllib.request, concurrent.futures, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "pokemon")
CDN = "https://cdn.jsdelivr.net/gh/Pokemon-3D-api/assets@main/models/opt"
RAW = "https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt"
N = 151

def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def tree_paths():
    data = json.loads(fetch("https://api.github.com/repos/Pokemon-3D-api/assets/git/trees/main?recursive=1"))
    return [t["path"] for t in data["tree"] if t["path"].endswith(".glb")]

def download(cat, name):
    path = os.path.join(OUT, cat, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return (cat, name, os.path.getsize(path), "cached")
    for base in (CDN, RAW):
        for attempt in range(3):
            try:
                data = fetch(f"{base}/{cat}/{name}")
                if data[:4] != b"glTF":
                    raise ValueError("not glb")
                with open(path, "wb") as f:
                    f.write(data)
                return (cat, name, len(data), "ok")
            except Exception as e:
                time.sleep(1 + attempt)
    return (cat, name, 0, "FAIL")

def main():
    paths = tree_paths()
    reg = set(); shiny = set()
    for p in paths:
        parts = p.split("/")
        if len(parts) == 4 and parts[2] in ("regular", "shiny"):
            base = parts[3][:-4]
            if base.isdigit():
                i = int(base)
                if 1 <= i <= N:
                    (reg if parts[2] == "regular" else shiny).add(i)
    print(f"regular available: {len(reg)}, shiny available: {len(shiny)}", flush=True)
    jobs = [("regular", f"{i}.glb") for i in sorted(reg)] + [("shiny", f"{i}.glb") for i in sorted(shiny)]
    results = []
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for res in ex.map(lambda j: download(*j), jobs):
            results.append(res)
            if res[3] != "cached":
                print(f"{res[0]}/{res[1]} {res[2]//1024}KB {res[3]}", flush=True)
    fails = [r for r in results if r[3] == "FAIL"]
    total = sum(r[2] for r in results)
    manifest = {
        "regular": sorted(reg - {int(r[1][:-4]) for r in fails if r[0]=='regular'}),
        "shiny": sorted(shiny - {int(r[1][:-4]) for r in fails if r[0]=='shiny'}),
    }
    with open(os.path.join(ROOT, "assets", "data", "models_manifest.json"), "w") as f:
        json.dump(manifest, f)
    print(f"DONE total={total//1024//1024}MB fails={len(fails)} {[r[:2] for r in fails]}", flush=True)

if __name__ == "__main__":
    main()
