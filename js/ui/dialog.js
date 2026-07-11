// 对话系统：NPC对话/选项 (Promise 化)
import { G } from '../core/engine.js';
import { Input } from '../core/input.js';

export class Dialog {
  constructor() {
    this.root = document.getElementById('dialog');
    this.active = false;
  }

  // lines: string[] | {text, name}[]
  async say(name, lines) {
    if (this.active) return;
    this.active = true;
    const prevState = G.state;
    G.state = 'dialog';
    G.player?.freeze(true);
    Input.unlock();
    this.root.classList.add('show');
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      const text = typeof line === 'string' ? line : line.text;
      const nm = typeof line === 'string' ? name : (line.name ?? name);
      await this.showLine(nm, text);
    }
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    G.state = prevState === 'dialog' ? 'roam' : prevState;
    G.player?.freeze(false);
    this.active = false;
  }

  showLine(name, text) {
    return new Promise(res => {
      this.root.innerHTML = `
        <div class="dlg-box panel">
          ${name ? `<div class="dlg-name">${name}</div>` : ''}
          <div class="dlg-text" id="dlgText"></div>
          <div class="dlg-next" id="dlgNext" style="opacity:0">▼ 继续</div>
        </div>`;
      const el = document.getElementById('dlgText');
      let i = 0;
      const iv = setInterval(() => {
        el.innerHTML = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(iv); document.getElementById('dlgNext').style.opacity = 1; }
      }, 18);
      let done = false;
      const finish = () => {
        if (done) return;
        if (i < text.length) { i = text.length; el.innerHTML = text; document.getElementById('dlgNext').style.opacity = 1; return; }
        done = true;
        removeEventListener('keydown', onKey);
        res();
      };
      const onKey = e => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') finish(); };
      addEventListener('keydown', onKey);
      this.root.querySelector('.dlg-box').onclick = finish;
    });
  }

  // 选项 → resolve(index)
  async choice(name, text, options) {
    if (this.active) return -1;
    this.active = true;
    const prevState = G.state;
    G.state = 'dialog';
    G.player?.freeze(true);
    Input.unlock();
    this.root.classList.add('show');
    const idx = await new Promise(res => {
      this.root.innerHTML = `
        <div class="dlg-box panel">
          ${name ? `<div class="dlg-name">${name}</div>` : ''}
          <div class="dlg-text">${text}</div>
          <div class="dlg-opts">${options.map((o, i) => `<button class="dlg-opt" data-i="${i}">${o}</button>`).join('')}</div>
        </div>`;
      this.root.querySelectorAll('.dlg-opt').forEach(b => b.onclick = () => res(+b.dataset.i));
    });
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    G.state = prevState === 'dialog' ? 'roam' : prevState;
    G.player?.freeze(false);
    this.active = false;
    return idx;
  }
}
