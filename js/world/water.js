// 水体：海/湖/河 统一水面着色器 + 火山熔岩
import * as THREE from 'three';
import { G, addUpdate } from '../core/engine.js';
import { WORLD } from './terrain.js';

export class Water {
  constructor(scene) {
    const uniforms = this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color('#57c8e8') },
        uDeep: { value: new THREE.Color('#1f6fc4') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color('#ffffff') },
        uNight: { value: 0 },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      transparent: true, uniforms,
      fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float uTime; varying vec3 vWorld; varying vec3 vN;
        void main(){
          vec3 p = position;
          float w = sin(p.x*0.08 + uTime*1.1) * cos(p.z*0.07 + uTime*0.9) * 0.22
                  + sin(p.x*0.021 - uTime*0.6) * 0.3;
          p.y += w;
          vec4 wp = modelMatrix * vec4(p,1.0); vWorld = wp.xyz;
          vN = normalize(vec3(-0.08*cos(p.x*0.08+uTime*1.1), 1.0, 0.07*sin(p.z*0.07+uTime*0.9)));
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 uShallow, uDeep, uSunColor, uSunDir; uniform float uTime, uNight;
        varying vec3 vWorld; varying vec3 vN;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(V, vN), 0.0), 2.2);
          float n = noise(vWorld.xz*0.14 + uTime*0.24) * 0.6 + noise(vWorld.xz*0.5 - uTime*0.15)*0.4;
          vec3 col = mix(uDeep, uShallow, n*0.55 + fres*0.4);
          // 波光
          float spark = pow(noise(vWorld.xz*1.4 + uTime*0.8), 8.0) * 1.6;
          vec3 R = reflect(-V, vN);
          float sunRef = pow(max(dot(R, uSunDir), 0.0), 60.0);
          col += uSunColor * (sunRef*0.9 + spark*0.25) * (1.0-uNight*0.55);
          col *= (1.0 - uNight*0.62);
          float alpha = 0.82 + fres*0.12;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(WORLD.size * 2.6, WORLD.size * 2.6, 96, 96);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WORLD.water - .12;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    // 熔岩池(火山口)
    const lavaU = this.lavaU = { uTime: { value: 0 } };
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD.volcano.r * .3, 40),
      new THREE.ShaderMaterial({
        uniforms: lavaU, fog: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `
          uniform float uTime; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          void main(){
            vec2 p = vUv*14.0;
            float n = noise(p + uTime*0.28)*0.6 + noise(p*2.7 - uTime*0.2)*0.4;
            vec3 hot = vec3(1.0, 0.85, 0.3), mid = vec3(0.95, 0.35, 0.08), dark = vec3(0.32, 0.06, 0.03);
            vec3 col = mix(dark, mid, smoothstep(0.32, 0.62, n));
            col = mix(col, hot, smoothstep(0.68, 0.9, n));
            gl_FragColor = vec4(col*1.5, 1.0);
          }`,
      })
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(WORLD.volcano.x, 57.5, WORLD.volcano.z);
    scene.add(lava);
    const lavaLight = new THREE.PointLight(0xff5a1e, 60, 160, 1.6);
    lavaLight.position.set(WORLD.volcano.x, 66, WORLD.volcano.z);
    scene.add(lavaLight);

    addUpdate(dt => {
      uniforms.uTime.value = G.time;
      lavaU.uTime.value = G.time;
      if (G.sky) {
        uniforms.uSunDir.value.copy(G.sky.uniforms.uSunDir.value);
        uniforms.uSunColor.value.copy(G.sky.uniforms.uSunColor.value);
        uniforms.uNight.value = G.sky.uniforms.uNight.value;
      }
      this.mesh.position.x = G.camera.position.x;
      this.mesh.position.z = G.camera.position.z;
    });
  }
}
