// 标题画面：新的旅程 / 继续冒险 / 联机大厅
import * as THREE from 'three';
import { G, addUpdate, removeUpdate } from '../core/engine.js';
import { GameState } from '../core/state.js';
import { getHeight, WORLD } from '../world/world.js';

export class Title {
  constructor(onStart) {
    this.root = document.getElementById('title');
    this.onStart = onStart;
  }

  show() {
    G.state = 'title';
    const has = GameState.hasSave();
    this.root.innerHTML = `
      <div class="title-wrap">
        <div class="title-logo">
          <div class="big">宝可梦 <em>宝石</em></div>
          <div class="sub">POKÉMON GEMS · 极光大陆</div>
        </div>
        <div class="title-menu">
          ${has ? `<button class="title-btn" data-a="continue">继续冒险 <small>CONTINUE</small></button>` : ''}
          <button class="title-btn" data-a="new">新的旅程 <small>NEW GAME</small></button>
          <button class="title-btn" data-a="net">联机大厅 <small>MULTIPLAYER</small></button>
        </div>
        <div class="title-hint">WASD移动 · Shift冲刺 · 空格跳跃/滑翔 · 右键瞄准+左键投球 · E交谈 · M菜单 · G坐骑</div>
        <div class="title-ver">同人致敬作品 · Pokémon © Nintendo/Creatures/GAME FREAK</div>
      </div>`;
    // 标题运镜: 环绕大陆
    this.camFn = addUpdate(dt => {
      const t = G.time * .045;
      const R = 420;
      const x = Math.cos(t) * R, z = 240 + Math.sin(t) * R * .7;
      const y = 130 + Math.sin(t * .7) * 30;
      G.camera.position.set(x, Math.max(y, getHeight(x, z) + 30), z);
      G.camera.lookAt(0, 40, -100);
    });
    this.root.querySelectorAll('.title-btn').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      G.audio?.unlock?.();
      G.audio?.sfx?.('menu');
      if (a === 'new') {
        if (has && !confirm('已有存档，开始新旅程将覆盖旧进度。确定？')) return;
        localStorage.removeItem('gem_save_0');
        this.hide(); this.onStart(null);
      } else if (a === 'continue') {
        const gs = GameState.load();
        this.hide(); this.onStart(gs);
      } else if (a === 'net') {
        this.hide(); this.onStart(GameState.hasSave() ? GameState.load() : null, true);
      }
    });
  }

  hide() {
    if (this.camFn) removeUpdate(this.camFn);
    this.root.innerHTML = '';
  }
}
