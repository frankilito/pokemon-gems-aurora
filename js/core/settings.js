// 全局设置：与游戏进度分离持久化(localStorage gem_settings)
// 音量分类 / 镜头灵敏度 / 减少晃动 / 字体缩放
import { G } from './engine.js';

const KEY = 'gem_settings';
const DEF = {
  master: .9,   // 总音量
  bgm: .45,     // 音乐
  sfx: .7,      // 音效(含UI)
  cry: 1,       // 精灵叫声(倍率)
  sens: 1,      // 镜头灵敏度(倍率)
  reduceMotion: false, // 减少镜头震动/FOV冲击
  fontScale: 1, // UI字体缩放
};

export const Settings = {
  data: { ...DEF },
  load() {
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 忽略损坏 */ }
    this.apply();
  },
  set(k, v) {
    this.data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
    this.apply();
  },
  reset() {
    this.data = { ...DEF };
    try { localStorage.removeItem(KEY); } catch (e) {}
    this.apply();
  },
  apply() {
    G.settings = this.data;
    document.documentElement.style.fontSize = Math.round(16 * this.data.fontScale) + 'px';
    G.audio?.applyVolumes?.();
  },
};
