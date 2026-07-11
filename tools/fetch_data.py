#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 PokeAPI 烘焙初代151只完整图鉴数据: 六维/属性/招式表/进化链/经验组/中文文本 → assets/data/dex.json"""
import json, os, re, time, urllib.request, concurrent.futures

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://pokeapi.co/api/v2"
N = 151
VG_PRIORITY = ["scarlet-violet", "sword-shield", "ultra-sun-ultra-moon", "sun-moon",
               "omega-ruby-alpha-sapphire", "x-y", "black-2-white-2", "black-white",
               "heartgold-soulsilver", "platinum", "diamond-pearl", "emerald",
               "firered-leafgreen", "ruby-sapphire", "crystal", "gold-silver", "yellow", "red-blue"]

def get_json(url, retries=4):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if i == retries - 1:
                print("FAIL", url, e, flush=True)
                return None
            time.sleep(1 + i)

def zh(names, key="name"):
    for lang in ("zh-hans", "zh-hant"):
        for n in names:
            if n["language"]["name"] == lang:
                return n[key]
    return None

def zh_flavor(entries, key="flavor_text"):
    for lang in ("zh-hans", "zh-hant"):
        for e in entries:
            if e["language"]["name"] == lang:
                return re.sub(r"\s+", "", e[key])
    return ""

def learnset(p):
    best_group, best = None, []
    by_group = {}
    for mv in p["moves"]:
        for d in mv["version_group_details"]:
            if d["move_learn_method"]["name"] == "level-up":
                g = d["version_group"]["name"]
                by_group.setdefault(g, []).append((d["level_learned_at"], mv["move"]["name"]))
    for g in VG_PRIORITY:
        if g in by_group:
            best_group, best = g, by_group[g]
            break
    best.sort()
    return [{"lv": lv, "m": m} for lv, m in best]

def fetch_species(i):
    p = get_json(f"{API}/pokemon/{i}")
    s = get_json(f"{API}/pokemon-species/{i}")
    st = {x["stat"]["name"]: x["base_stat"] for x in p["stats"]}
    return {
        "id": i, "name": p["name"],
        "zh": zh(s["names"]) or p["name"],
        "types": [t["type"]["name"] for t in p["types"]],
        "stats": {"hp": st["hp"], "atk": st["attack"], "def": st["defense"],
                   "spa": st["special-attack"], "spd": st["special-defense"], "spe": st["speed"]},
        "catch": s["capture_rate"],
        "baseExp": p.get("base_experience") or 60,
        "growth": s["growth_rate"]["name"],
        "legendary": s["is_legendary"] or s["is_mythical"],
        "genderRate": s["gender_rate"],
        "genus": (zh(s.get("genera", []), "genus") or ""),
        "dex": zh_flavor(s.get("flavor_text_entries", [])),
        "height": p["height"], "weight": p["weight"],
        "moves": learnset(p),
        "chain": s["evolution_chain"]["url"],
    }

def fetch_move(name):
    m = get_json(f"{API}/move/{name}")
    if not m: return None
    meta = m.get("meta") or {}
    out = {
        "name": name,
        "zh": zh(m["names"]) or name,
        "type": m["type"]["name"],
        "class": m["damage_class"]["name"],
        "power": m["power"], "acc": m["accuracy"], "pp": m["pp"],
        "priority": m["priority"],
        "target": m["target"]["name"],
        "ailment": (meta.get("ailment") or {}).get("name", "none"),
        "ailmentChance": meta.get("ailment_chance", 0),
        "critRate": meta.get("crit_rate", 0),
        "drain": meta.get("drain", 0),
        "healing": meta.get("healing", 0),
        "flinch": meta.get("flinch_chance", 0),
        "hits": [meta.get("min_hits"), meta.get("max_hits")],
        "statChanges": [{"stat": sc["stat"]["name"], "chg": sc["change"]} for sc in m.get("stat_changes", [])],
        "statChance": meta.get("stat_chance", 0),
        "fx": zh_flavor(m.get("flavor_text_entries", [])),
    }
    return out

def main():
    print("== species ==", flush=True)
    with concurrent.futures.ThreadPoolExecutor(10) as ex:
        mons = list(ex.map(fetch_species, range(1, N + 1)))
    mons.sort(key=lambda m: m["id"])

    print("== evolution ==", flush=True)
    urls = sorted(set(m["chain"] for m in mons))
    with concurrent.futures.ThreadPoolExecutor(10) as ex:
        chains = list(ex.map(get_json, urls))
    name2id = {m["name"]: m["id"] for m in mons}
    evo = {}
    def walk(node):
        frm = node["species"]["name"]
        for nxt in node.get("evolves_to", []):
            to = nxt["species"]["name"]
            if frm in name2id and to in name2id:
                method = {"to": name2id[to]}
                det = nxt.get("evolution_details") or [{}]
                d = det[0]
                trig = (d.get("trigger") or {}).get("name", "level-up")
                if d.get("min_level"):
                    method["method"] = "level"; method["lv"] = d["min_level"]
                elif d.get("item"):
                    method["method"] = "item"; method["item"] = d["item"]["name"]
                elif trig == "trade":
                    method["method"] = "item"; method["item"] = "linking-cord"
                elif d.get("min_happiness"):
                    method["method"] = "friendship"; method["lv"] = 25
                else:
                    method["method"] = "level"; method["lv"] = 32
                evo.setdefault(name2id[frm], []).append(method)
            walk(nxt)
    for c in chains:
        if c: walk(c["chain"])

    print("== moves ==", flush=True)
    move_names = sorted(set(mv["m"] for m in mons for mv in m["moves"]))
    print("unique moves:", len(move_names), flush=True)
    with concurrent.futures.ThreadPoolExecutor(10) as ex:
        moves = [m for m in ex.map(fetch_move, move_names) if m]

    for m in mons:
        del m["chain"]
        m["evo"] = evo.get(m["id"], [])

    out = {"species": mons, "moves": {m["name"]: m for m in moves}}
    path = os.path.join(ROOT, "assets", "data", "dex.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("DONE dex.json", os.path.getsize(path) // 1024, "KB, species:", len(mons), "moves:", len(moves), flush=True)

if __name__ == "__main__":
    main()
