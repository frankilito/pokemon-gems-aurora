// 输入：键盘 + 鼠标(指针锁定视角) + 动作映射
import { G, emit } from './engine.js';

export const Input = {
  keys: new Set(),
  pressed: new Set(),      // 本帧刚按下
  mouse: { dx: 0, dy: 0, wheel: 0, down: false, rDown: false },
  locked: false,
  enabled: true,

  init() {
    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = norm(e.code);
      this.keys.add(k); this.pressed.add(k);
      emit('key', k);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(norm(e.code)));
    addEventListener('blur', () => this.keys.clear());

    const canvas = G.canvas;
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rDown = true;
      emit('mousedown', e.button);
      if (!this.locked && this.enabled && (G.state === 'roam')) canvas.requestPointerLock();
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rDown = false;
      emit('mouseup', e.button);
    });
    addEventListener('mousemove', e => {
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  // 每帧末调用
  flush() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; },

  down(k) { return this.keys.has(k); },
  hit(k) { return this.pressed.has(k); },
  axis() { // WASD → [x, z]
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    return [x, z];
  },
  unlock() { if (this.locked) document.exitPointerLock(); },
};
const norm = c => c;
