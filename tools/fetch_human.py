#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 ReadyPlayerMe 化身(男/女) + 动画库精选剪辑 → assets/models/human/"""
import os, urllib.request, concurrent.futures

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "human")
os.makedirs(OUT, exist_ok=True)
BASE = "https://raw.githubusercontent.com/readyplayerme/animation-library/master"

FILES = {
    # 身体
    "avatar_m.glb": "masculine/glb/Masculine_TPose.glb",
    "avatar_f.glb": "feminine/glb/Feminine_TPose.glb",
    # 男性动作
    "m_idle.glb": "masculine/glb/idle/M_Standing_Idle_001.glb",
    "m_idle_var1.glb": "masculine/glb/idle/M_Standing_Idle_Variations_001.glb",
    "m_idle_var2.glb": "masculine/glb/idle/M_Standing_Idle_Variations_002.glb",
    "m_walk.glb": "masculine/glb/locomotion/M_Walk_001.glb",
    "m_jog.glb": "masculine/glb/locomotion/M_Jog_001.glb",
    "m_run.glb": "masculine/glb/locomotion/M_Run_001.glb",
    "m_jump.glb": "masculine/glb/locomotion/M_Jog_Jump_001.glb",
    "m_fall.glb": "masculine/glb/locomotion/M_Falling_Idle_002.glb",
    "m_crouchwalk.glb": "masculine/glb/locomotion/M_Crouch_Walk_003.glb",
    "m_crouchidle.glb": "masculine/glb/locomotion/M_Crouch_Idle_001.glb",
    "m_talk1.glb": "masculine/glb/expression/M_Talking_Variations_001.glb",
    "m_talk2.glb": "masculine/glb/expression/M_Talking_Variations_002.glb",
    "m_dance.glb": "masculine/glb/dance/M_Dances_001.glb",
    # 女性动作
    "f_idle.glb": "feminine/glb/idle/F_Standing_Idle_001.glb",
    "f_idle_var1.glb": "feminine/glb/idle/F_Standing_Idle_Variations_001.glb",
    "f_walk.glb": "feminine/glb/locomotion/F_Walk_002.glb",
    "f_jog.glb": "feminine/glb/locomotion/F_Jog_001.glb",
    "f_talk1.glb": "feminine/glb/expression/F_Talking_Variations_001.glb",
    "f_talk2.glb": "feminine/glb/expression/F_Talking_Variations_002.glb",
    "f_dance.glb": "feminine/glb/dance/F_Dances_001.glb",
}

def dl(pair):
    name, path = pair
    dst = os.path.join(OUT, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return name, "cached"
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if data[:4] != b"glTF":
                raise ValueError("not glb: " + path)
            open(dst, "wb").write(data)
            return name, f"{len(data)//1024}KB"
        except Exception as e:
            err = e
    return name, f"FAIL {err}"

with concurrent.futures.ThreadPoolExecutor(6) as ex:
    for name, st in ex.map(dl, FILES.items()):
        print(name, st, flush=True)
print("DONE")
