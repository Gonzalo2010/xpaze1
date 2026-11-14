// Paze: el orbe WebGL de la presentación de XPaze (diapositivas de Mente).
// Respira, late, sigue el puntero y se deforma con la voz. Estados de ánimo con sus colores:
//   calma · escucha · empatia · atencion · respira
// Uso: const orb = new PazeOrb(hostElement, { mood: 'calma' }); orb.start();
//      orb.setMood('escucha'); orb.speaking = true; orb.speechAmp = 0..1; orb.stop();

const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const PAZE_PRESETS = {
  calma: { energy: 0.5, ripple: 0, size: 1, a: '#2f7bff', b: '#6fd6ff', c: '#b9a6ff' },
  escucha: { energy: 1.1, ripple: 1, size: 1.03, a: '#17b8ff', b: '#5ef0ff', c: '#a8ecff' },
  empatia: { energy: 0.6, ripple: 0, size: 1.02, a: '#ff7a59', b: '#ffb38a', c: '#ff8fb8' },
  atencion: { energy: 1.5, ripple: 0, size: 0.95, a: '#ff9f0a', b: '#ffd166', c: '#ff6a3d' },
  respira: { energy: 0.35, ripple: 0, size: 1, a: '#19c38a', b: '#7be8b4', c: '#c4f5de' },
};

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
const FS = `precision highp float;
uniform vec2 uRes;uniform float uTime,uAmp,uBreath,uHeart,uEnergy,uRipple,uSize;uniform vec3 uA,uB,uC;uniform vec2 uMouse;
float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.02;a*=0.5;}return v;}
void main(){float m=min(uRes.x,uRes.y);vec2 uv=(gl_FragCoord.xy-0.5*uRes)/m;float t=uTime;float ang=atan(uv.y,uv.x);float d=length(uv);
float R=0.27*uSize*(1.0+0.04*uBreath+0.035*uHeart);vec2 dir=vec2(cos(ang),sin(ang));
float n1=noise(vec3(dir*1.4,t*0.45*uEnergy));float n2=noise(vec3(dir*3.2+5.0,t*1.0*uEnergy));
float edge=R*(1.0+0.07*(n1-0.5)*2.0+0.03*(n2-0.5)*2.0+uAmp*0.12*(n2*2.0-1.0)+uAmp*0.05*sin(ang*6.0+t*8.0));
float px=1.6/m;float inside=1.0-smoothstep(edge-px,edge+px,d);float rr=clamp(d/edge,0.0,1.0);float z=sqrt(max(0.0,1.0-rr*rr));
vec3 N=normalize(vec3(uv/edge,z+0.001));vec3 p=N*1.7+vec3(0.0,0.0,t*0.16*uEnergy);float f=fbm(p+fbm(p*1.3+t*0.1*uEnergy));
vec3 col=mix(uA,uB,smoothstep(0.25,0.75,f));col=mix(col,uC,smoothstep(0.5,0.95,fbm(p*2.1-t*0.13*uEnergy))*0.8);
col+=0.12*uAmp*sin(N.y*9.0+t*9.0);vec3 L=normalize(vec3(-0.45+uMouse.x*0.35,0.6-uMouse.y*0.35,0.8));
float diff=clamp(dot(N,L)*0.5+0.5,0.0,1.0);col*=0.62+0.6*diff;float fres=pow(1.0-z,2.3);col+=uC*fres*0.95;
float spec=pow(max(dot(reflect(-L,N),vec3(0.0,0.0,1.0)),0.0),38.0);col+=vec3(1.0)*spec*0.5;
col+=uA*(1.0-rr)*(1.0-rr)*0.22*(1.0+uHeart*0.9+uAmp*0.7);float rip=0.0;
for(int i=0;i<3;i++){float ph=fract(t*0.32+float(i)/3.0);float rad=edge*(1.04+ph*0.85);float w=0.008+0.012*ph;rip+=exp(-pow((d-rad)/w,2.0))*(1.0-ph);}
float halo=exp(-max(d-edge,0.0)*8.0)*(0.5+0.3*uAmp+0.15*uHeart);vec3 outer=uB*halo+uC*rip*uRipple*0.8;
float fadeEdge=1.0-smoothstep(0.34,0.5,d);outer*=fadeEdge;float aOut=clamp(halo*0.9+rip*uRipple*0.7,0.0,1.0)*fadeEdge;vec3 rgb=col*inside+(1.0-inside)*outer*0.75;
float a=clamp(inside+(1.0-inside)*aOut*0.75,0.0,1.0);gl_FragColor=vec4(rgb,a);}`;

const hex3 = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
let ptrX = typeof innerWidth !== 'undefined' ? innerWidth / 2 : 0;
let ptrY = typeof innerHeight !== 'undefined' ? innerHeight / 2 : 0;
if (typeof addEventListener !== 'undefined') addEventListener('pointermove', (e) => { ptrX = e.clientX; ptrY = e.clientY; }, { passive: true });

export class PazeOrb {
  constructor(host, o = {}) {
    this.host = host;
    this.rip = o.ripple;
    this.hr = o.hr || 64;
    this.speaking = false;
    this.speechAmp = 0;
    this.mouth = 0;
    this.breathFn = null;
    this.clock = Math.random() * 20;
    this.hp = 0; this.smx = 0; this.smy = 0;
    this.running = false;
    this.mood = PAZE_PRESETS[o.mood] ? o.mood : 'calma';
    const p = PAZE_PRESETS[this.mood];
    this.cur = { energy: p.energy, ripple: this.rip ?? p.ripple, size: p.size, a: hex3(p.a), b: hex3(p.b), c: hex3(p.c) };
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    host.appendChild(cv);
    this.cv = cv;
    let gl = null;
    try { gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }); } catch { /* sin WebGL */ }
    if (gl) {
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) gl = null;
      else {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        this.U = {};
        for (const n of ['uRes', 'uTime', 'uAmp', 'uBreath', 'uHeart', 'uEnergy', 'uRipple', 'uSize', 'uA', 'uB', 'uC', 'uMouse']) this.U[n] = gl.getUniformLocation(prog, n);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
    }
    this.gl = gl;
    if (!gl) { cv.remove(); host.classList.add('orb-fallback'); return; }
    this.resize();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => { this.resize(); this.draw(0); }); this.ro.observe(host); }
    this.draw(0);
  }

  resize() {
    if (!this.gl) return;
    const r = this.host.getBoundingClientRect();
    const d = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.max(2, Math.round(r.width * d));
    this.cv.height = Math.max(2, Math.round(r.height * d));
    this.gl.viewport(0, 0, this.cv.width, this.cv.height);
  }

  setMood(m) { if (PAZE_PRESETS[m]) this.mood = m; }

  draw(dt) {
    const gl = this.gl;
    if (!gl) return;
    const tg = PAZE_PRESETS[this.mood], c = this.cur, k = 1 - Math.exp(-dt * 5);
    c.energy += (tg.energy - c.energy) * k;
    c.size += (tg.size - c.size) * k;
    c.ripple += ((this.rip ?? tg.ripple) - c.ripple) * k;
    const ta = hex3(tg.a), tb = hex3(tg.b), tc = hex3(tg.c);
    for (let i = 0; i < 3; i++) { c.a[i] += (ta[i] - c.a[i]) * k; c.b[i] += (tb[i] - c.b[i]) * k; c.c[i] += (tc[i] - c.c[i]) * k; }
    this.mouth += ((this.speaking ? this.speechAmp : 0) - this.mouth) * (1 - Math.exp(-dt * 16));
    const r = this.host.getBoundingClientRect();
    let mx = 0, my = 0;
    if (r.width) { mx = Math.max(-1, Math.min(1, ((ptrX - r.left) / r.width) * 2 - 1)); my = Math.max(-1, Math.min(1, ((ptrY - r.top) / r.height) * 2 - 1)); }
    this.smx += (mx - this.smx) * (1 - Math.exp(-dt * 5));
    this.smy += (my - this.smy) * (1 - Math.exp(-dt * 5));
    let bv = 0.5 + 0.5 * Math.sin(this.clock * 1.1), size = c.size, breathing = false;
    if (this.breathFn) { const b = this.breathFn(); if (b != null) { bv = b; size = c.size * (0.78 + 0.4 * b); breathing = true; } }
    const listen = this.mood === 'escucha' && !this.speaking && !breathing
      ? Math.max(0, 0.16 + 0.14 * Math.sin(this.clock * 3.1) * Math.sin(this.clock * 1.3) + 0.05 * Math.sin(this.clock * 7.7)) : 0;
    const amp = Math.min(1.2, this.mouth * 0.95 + listen);
    this.hp = (this.hp + dt * (this.hr / 60)) % 1;
    const hb = Math.exp(-Math.pow((this.hp - 0.05) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((this.hp - 0.3) / 0.07, 2));
    const U = this.U, slow = RM ? 0.35 : 1;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, this.cv.width, this.cv.height);
    gl.uniform1f(U.uTime, this.clock);
    gl.uniform1f(U.uAmp, amp);
    gl.uniform1f(U.uBreath, breathing ? bv - 0.5 : (bv - 0.5) * 0.7);
    gl.uniform1f(U.uHeart, RM ? 0 : hb);
    gl.uniform1f(U.uEnergy, c.energy * slow * (1 + amp * 0.5));
    gl.uniform1f(U.uRipple, c.ripple);
    gl.uniform1f(U.uSize, size);
    gl.uniform3f(U.uA, c.a[0], c.a[1], c.a[2]);
    gl.uniform3f(U.uB, c.b[0], c.b[1], c.b[2]);
    gl.uniform3f(U.uC, c.c[0], c.c[1], c.c[2]);
    gl.uniform2f(U.uMouse, this.smx, this.smy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  start() {
    if (this.running || !this.gl) return;
    this.running = true;
    let prev = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      this.clock += dt;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.speaking = false;
    this.speechAmp = 0;
    this.breathFn = null;
  }

  destroy() { this.stop(); this.ro?.disconnect(); this.cv?.remove(); }
}

// Estados de la sesión de voz (voice.js) → estado de ánimo de Paze.
export const VOICE_MOOD = {
  idle: 'calma', connecting: 'calma', listening: 'escucha', user: 'escucha',
  thinking: 'atencion', speaking: 'empatia', error: 'atencion',
};

// Conecta un PazeOrb a una VoiceSession: color según el estado y boca según el volumen.
export function bindOrbToVoice(orb) {
  let state = 'idle';
  return {
    state(st) {
      state = st;
      orb.setMood(VOICE_MOOD[st] || 'calma');
      orb.speaking = st === 'speaking' || st === 'user';
      if (!orb.speaking) orb.speechAmp = 0;
    },
    level(l) { if (state === 'speaking' || state === 'user') orb.speechAmp = Math.min(1, l * 1.6); },
  };
}
