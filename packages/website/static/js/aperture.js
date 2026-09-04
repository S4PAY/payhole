import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const css = (n, fb) => (getComputedStyle(document.body).getPropertyValue(n).trim() || fb);

// procedural tiled value noise (stands in for perlin rgb-256x256.png)
function noiseTex(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  const grid = 8, g = []; for (let i = 0; i < grid * grid * 4; i++) g.push(Math.random());
  const val = (x, y, ch) => {
    const gx = x * grid, gy = y * grid, x0 = Math.floor(gx) % grid, y0 = Math.floor(gy) % grid, x1 = (x0 + 1) % grid, y1 = (y0 + 1) % grid;
    const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy), s = t => t * t * (3 - 2 * t);
    const a = g[(y0 * grid + x0) * 4 + ch], b = g[(y0 * grid + x1) * 4 + ch], cc = g[(y1 * grid + x0) * 4 + ch], dd = g[(y1 * grid + x1) * 4 + ch];
    return (a + (b - a) * s(fx)) * (1 - s(fy)) + (cc + (dd - cc) * s(fx)) * s(fy);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, u = x / size, v = y / size;
    for (let ch = 0; ch < 4; ch++) d[i + ch] = 255 * (0.5 * val(u, v, ch) + 0.3 * val((u * 2) % 1, (v * 2) % 1, (ch + 1) % 4) + 0.2 * val((u * 4) % 1, (v * 4) % 1, (ch + 2) % 4));
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

const common = `
uniform sampler2D tNoise; uniform float uTime; uniform vec3 uColor;
varying vec2 vUv;
float remap(float v){ return clamp((v-0.45)/(0.7-0.45),0.0,1.0); }
vec2 skew(vec2 uv, vec2 k){ return vec2(uv.x+uv.y*k.x, uv.y+uv.x*k.y); }
vec2 radial(vec2 uv, vec2 mul, float rot, float off){
  vec2 c=uv-0.5; float d=length(c); float a=atan(c.y,c.x);
  vec2 r=vec2((a+3.14159265)/6.2831853, d); r*=mul; r.x+=rot; r.y+=off; return r; }`;

const cylVert = `
uniform float uTime; uniform float uStrength, uOffset, uAmp;
varying vec2 vUv;
void main(){
  vUv=uv;
  float angle=atan(position.z,position.x); float y=position.y;
  float radius=pow(uStrength*(y-uOffset),2.0)+uAmp;
  radius+=sin((y-uTime)*20.0+angle*2.0)*0.05;
  vec3 p=vec3(cos(angle)*radius,y,sin(angle)*radius);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;

const emissiveFrag = common + `
void main(){
  vec2 u1=skew(vUv+vec2(uTime,-uTime),vec2(-1.0,0.0))*vec2(2.0,0.25);
  float n1=remap(texture2D(tNoise,u1).r);
  vec2 u2=skew(vUv+vec2(uTime*0.5,-uTime),vec2(-1.0,0.0))*vec2(5.0,1.0);
  float n2=remap(texture2D(tNoise,u2).g);
  float fade=min(smoothstep(0.0,0.1,vUv.y),smoothstep(0.0,0.4,1.0-vUv.y));
  float e=n1*n2*fade;
  float lum=dot(uColor,vec3(0.2126,0.7152,0.0722));
  gl_FragColor=vec4(uColor*1.2/lum, smoothstep(0.0,0.1,e));
}`;

const darkFrag = common + `
void main(){
  float t=uTime+123.4;
  vec2 u1=skew(vUv+vec2(t,-t),vec2(-1.0,0.0))*vec2(2.0,0.25);
  float n1=remap(texture2D(tNoise,u1).g);
  vec2 u2=skew(vUv+vec2(t*0.5,-t),vec2(-1.0,0.0))*vec2(5.0,1.0);
  float n2=remap(texture2D(tNoise,u2).b);
  float fade=min(smoothstep(0.0,0.2,vUv.y),smoothstep(0.0,0.4,1.0-vUv.y));
  float e=n1*n2*fade;
  gl_FragColor=vec4(vec3(0.0), smoothstep(0.0,0.01,e));
}`;

const floorVert = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const floorFrag = common + `
void main(){
  vec2 u1=radial(vUv,vec2(0.5,0.5),uTime,uTime); u1=skew(u1,vec2(-1.0,0.0))*vec2(4.0,1.0);
  float n1=remap(texture2D(tNoise,u1).r);
  vec2 u2=radial(vUv,vec2(2.0,8.0),uTime*2.0,uTime*8.0); u2=skew(u2,vec2(-0.25,0.0))*vec2(2.0,0.25);
  float n2=remap(texture2D(tNoise,u2).b);
  float d=length(vUv-0.5);
  float fade=min(smoothstep(0.5,0.9,1.0-d),smoothstep(0.0,0.2,d));
  float e=n1*n2*fade;
  gl_FragColor=vec4(uColor*step(0.2,e)*3.0, smoothstep(0.0,0.01,e));
}`;

class ApertureScene extends HTMLElement {
  connectedCallback() {
    this.style.cssText += 'display:block;width:100%;height:100%;position:relative;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.appendChild(canvas);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.clearCol = new THREE.Color(css('--bg', '#000000')); r.setClearColor(this.clearCol, 1);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(25, 1, 0.1, 50);
    this.cam.position.set(1, 1, 3); this.cam.lookAt(0, 0.4, 0);

    const tNoise = noiseTex();
    const color = new THREE.Color(css('--accent', '#2BFF88'));
    this.u = { tNoise: { value: tNoise }, uTime: { value: 0 }, uColor: { value: color }, uStrength: { value: 1 }, uOffset: { value: 0.3 }, uAmp: { value: 0.2 } };
    const uEm = { ...this.u, uAmp: { value: 0.15 } }; this.uEm = uEm;

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 20, 20, true); cyl.translate(0, 0.5, 0);
    this.emissive = new THREE.Mesh(cyl, new THREE.ShaderMaterial({ uniforms: uEm, vertexShader: cylVert, fragmentShader: emissiveFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.dark = new THREE.Mesh(cyl, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: cylVert, fragmentShader: darkFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: floorVert, fragmentShader: floorFrag, transparent: true, depthWrite: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.group = new THREE.Group(); this.group.add(this.floor, this.dark, this.emissive); this.scene.add(this.group);

    this.composer = new EffectComposer(r);
    const rp = new RenderPass(this.scene, this.cam); rp.clearColor = this.clearCol; rp.clearAlpha = 1;
    this.composer.addPass(rp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1, 0.1, 0.9);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());

    this.p = 0; this.mx = 0; this.my = 0; this.last = performance.now(); this.t = 0;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this);
    this.onMove = e => { this.mx = e.clientX / innerWidth - 0.5; this.my = e.clientY / innerHeight - 0.5; };
    addEventListener('pointermove', this.onMove, { passive: true });
    this.resize(); this.loop();
  }
  disconnectedCallback() { cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('pointermove', this.onMove); this.renderer.dispose(); }
  progress() {
    const t = this.closest('[data-scroll-track]'); if (!t) return 0;
    const r = t.getBoundingClientRect(), range = r.height - innerHeight;
    return range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;
  }
  resize() {
    const w = this.clientWidth || 1, h = this.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const target = this.progress(); this.p += (target - this.p) * 0.08; const p = this.p;
    // scroll: tornado spins faster, widens (parabola strength drops, amplitude grows) and brightens
    this.t += dt * (0.06 + p * 0.12);
    this.u.uTime.value = this.uEm.uTime.value = this.t;
    this.u.uStrength.value = this.uEm.uStrength.value = 1 - p * 0.45;
    this.u.uAmp.value = 0.2 + p * 0.25; this.uEm.uAmp.value = 0.15 + p * 0.25;
    this.bloom.strength = 0.7 + p * 0.5;
    // camera: slow orbit + pointer parallax; frame right column on wide screens
    const asp = this.cam.aspect, wide = Math.min(1, Math.max(0, (asp - 0.9) / 0.6));
    const ang = 0.35 + this.t * 0.4 + this.mx * 0.25, dist = 3.2 - p * 0.4;
    this.cam.position.set(Math.sin(ang) * dist, 1 + this.my * -0.3 + p * 0.3, Math.cos(ang) * dist);
    const cx = wide * (0.8 + p * 0.3) * Math.min(1, asp / 1.6);
    this.group.position.set(0, -0.1, 0);
    this.cam.lookAt(0, 0.4, 0);
    // shift framing horizontally via view offset so the tornado sits in the right column
    const w = this.clientWidth || 1, h = this.clientHeight || 1;
    this.cam.setViewOffset(w, h, -cx * w * 0.5, 0, w, h);
    this.renderer.clear(); this.composer.render();
  }
}
customElements.define('aperture-scene', ApertureScene);
