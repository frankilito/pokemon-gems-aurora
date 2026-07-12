// 地形细节贴图：4通道 splat(草/岩/雪/沙) + 法线扰动 + 距离淡出
// 顶点色保持艺术方向, 细节层做亮度/色彩调制 —— onBeforeCompile 注入 MeshStandardMaterial
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math.js';

const TL = new THREE.TextureLoader();
function tex(path, srgb = false) {
  const t = TL.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// 程序化沙地(平铺 value-noise, 免下载)
function makeSandTex(normal = false) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  // 可平铺多倍频噪声
  for (let f = 1; f <= 4; f++) {
    const n = 4 * f, cell = S / n, amp = 1 / f;
    const g = [];
    for (let i = 0; i < n * n; i++) g.push(Math.random());
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx) % n, y0 = Math.floor(gy) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const fx = gx % 1, fy = gy % 1;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const v = (g[y0 * n + x0] * (1 - sx) + g[y0 * n + x1] * sx) * (1 - sy)
              + (g[y1 * n + x0] * (1 - sx) + g[y1 * n + x1] * sx) * sy;
      h[y * S + x] += v * amp;
    }
  }
  for (let i = 0; i < S * S; i++) {
    const v = h[i] / 1.9;
    if (!normal) {
      const r = 205 + v * 42, g2 = 185 + v * 40, b = 140 + v * 34;
      img.data[i * 4] = r; img.data[i * 4 + 1] = g2; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    } else {
      const x = i % S, y = (i / S) | 0;
      const dx = h[y * S + (x + 1) % S] - v * 1.9, dy = h[((y + 1) % S) * S + x] - v * 1.9;
      img.data[i * 4] = clamp(128 - dx * 700, 0, 255);
      img.data[i * 4 + 1] = clamp(128 - dy * 700, 0, 255);
      img.data[i * 4 + 2] = 235; img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!normal) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 每顶点 splat 权重: (grass, rock, snow, sand)
export function computeSplat(x, z, h, biome, slope, out) {
  let g = 0, r = 0, s = 0, d = 0;
  switch (biome) {
    case 'grass': case 'forest': case 'town': case 'lake': g = 1; break;
    case 'snow': case 'temple': s = 1; break;
    case 'volcano': case 'cave': r = 1; break;
    case 'ruins': g = .45; d = .55; break;
    case 'beach': case 'sea': d = 1; break;
    default: g = 1;
  }
  // 湖岸/低地渐变为沙
  if ((biome === 'lake' || biome === 'grass') && h < 2.2) { const t = smoothstep(2.2, .4, h); d += t; g -= t * .8; }
  // 陡坡露岩
  const rockT = smoothstep(.5, .85, slope);
  r += rockT * 1.4;
  // 高山雪线
  if (h > 55 && biome !== 'volcano') s += smoothstep(58, 74, h) * (1 - rockT * .6);
  const sum = Math.max(.001, g + r + s + d);
  out[0] = g / sum; out[1] = r / sum; out[2] = s / sum; out[3] = d / sum;
}

export function applyTerrainDetail(mat) {
  const u = {
    tGrassC: { value: tex('assets/textures/grass/color.jpg', true) },
    tGrassN: { value: tex('assets/textures/grass/normal.jpg') },
    tRockC: { value: tex('assets/textures/rock/color.jpg', true) },
    tRockN: { value: tex('assets/textures/rock/normal.jpg') },
    tSnowC: { value: tex('assets/textures/snow/color.jpg', true) },
    tSnowN: { value: tex('assets/textures/snow/normal.jpg') },
    tSandC: { value: makeSandTex(false) },
    tSandN: { value: makeSandTex(true) },
  };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrassC, tGrassN, tRockC, tRockN, tSnowC, tSnowN, tSandC, tSandN;
        varying vec4 vSplat;
        varying vec3 vWPos;
        vec3 sample2scale(sampler2D t, vec2 uv) {
          // 双尺度混合破平铺
          return mix(texture2D(t, uv * .34).rgb, texture2D(t, uv * .071).rgb, .42);
        }`)
      // 反照率调制
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float detailFade = 1.0 - smoothstep(120.0, 230.0, length(vWPos - cameraPosition));
        if (detailFade > .003) {
          vec2 wuv = vWPos.xz;
          vec3 det = sample2scale(tGrassC, wuv) * vSplat.x
                   + sample2scale(tRockC, wuv * .5) * vSplat.y
                   + sample2scale(tSnowC, wuv * .6) * vSplat.z
                   + sample2scale(tSandC, wuv * .8) * vSplat.w;
          float luma = dot(det, vec3(.299, .587, .114));
          // 亮度细节 + 少量本色注入(保持顶点色艺术方向)
          vec3 detail = mix(vec3(luma * 1.9), det * 2.2, .38);
          diffuseColor.rgb *= mix(vec3(1.0), detail, .62 * detailFade);
        }
      }`)
      // 法线扰动(导数切线系, 无需 tangent attribute)
      .replace('#include <normal_fragment_maps>', `
      {
        float detailFade = 1.0 - smoothstep(90.0, 190.0, length(vWPos - cameraPosition));
        if (detailFade > .003) {
          vec2 wuv = vWPos.xz;
          vec3 mapN = texture2D(tGrassN, wuv * .34).rgb * vSplat.x
                    + texture2D(tRockN, wuv * .17).rgb * vSplat.y
                    + texture2D(tSnowN, wuv * .2).rgb * vSplat.z
                    + texture2D(tSandN, wuv * .27).rgb * vSplat.w;
          mapN = mapN * 2.0 - 1.0;
          mapN.xy *= .85 * detailFade;
          vec3 q0 = dFdx(-vViewPosition);
          vec3 q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(wuv);
          vec2 st1 = dFdy(wuv);
          vec3 Nn = normalize(normal);
          vec3 q1perp = cross(q1, Nn);
          vec3 q0perp = cross(Nn, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det2 = max(dot(T, T), dot(B, B));
          float scaleT = (det2 == 0.0) ? 0.0 : inversesqrt(det2);
          normal = normalize(T * (mapN.x * scaleT) + B * (mapN.y * scaleT) + Nn * mapN.z);
        }
      }`);
  };
  mat.needsUpdate = true;
}
