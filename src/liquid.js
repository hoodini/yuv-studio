// The studio backdrop: one WebGL fragment shader shared by the editor, the home page and the films.
// Studio black with slow washes of violet and blue, cyan light from one side and a little magenta bokeh:
// the stage of the YUV.AI design system v5 (Neon Studio). The colours are its tokens.

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

const FRAG = `
precision highp float;
uniform vec2 r;      // canvas size in pixels
uniform float t;     // seconds
uniform vec2 m;      // pointer, in the same space as p
uniform float glass; // 0 = the wash only, 1 = bokeh lights at full strength
uniform float side;  // +1 = the cyan light comes from the right, -1 = from the left
uniform vec3 focus;  // where the bokeh gathers: centre x, centre y, spread

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}

const vec3 BG=vec3(.031,.031,.047);      // #08080C
const vec3 INDIGO=vec3(.165,.165,.345);  // #2A2A58
const vec3 VIOLET=vec3(.275,.271,.667);  // #4645AA
const vec3 VIOLET2=vec3(.478,.420,1.);   // #7A6BFF
const vec3 CYAN=vec3(.090,.737,.812);    // #17BCCF
const vec3 PINK=vec3(.878,.545,.894);    // #E08BE4

void main(){
  vec2 p=(gl_FragCoord.xy-.5*r)/r.y;
  float asp=r.x/r.y;
  // the wall wash: slow violet-blue light, brighter low on the frame, never grey
  vec2 q=vec2(fbm(p*.9+vec2(0.,t*.03)),fbm(p*.9+vec2(5.2,-t*.025)));
  float f=fbm(p*1.1+(q-.5)*1.2+vec2(t*.02,0.));
  vec3 col=BG;
  col+=INDIGO*(.55*smoothstep(.25,.85,f))*smoothstep(.9,-.6,p.y);
  col+=VIOLET*.38*smoothstep(.5,.95,f)*smoothstep(.7,-.5,p.y);
  // cyan from one side, as from a neon sign off frame
  float cx=side*(asp*.5+.15);
  float c=exp(-length(vec2((p.x-cx)*.9,p.y-.18))*1.55);
  col+=CYAN*c*.42;
  // a quieter violet answer from the other side, low
  float v=exp(-length(vec2((p.x+cx)*.8,p.y+.42))*1.7);
  col+=VIOLET2*v*.30;
  // the pointer carries a small light of its own
  col+=VIOLET2*exp(-dot(p-m,p-m)*9.)*.10;
  if(glass>0.){
    // bokeh: soft discs that drift, mostly violet and cyan, a few magenta
    for(int i=0;i<9;i++){
      float fi=float(i);
      vec2 c0=focus.xy+focus.z*vec2(sin(t*(.07+.013*fi)+fi*2.4)*(.95+.05*fi),cos(t*(.05+.011*fi)+fi*1.7)*.52);
      float rad=focus.z*(.05+.045*h(vec2(fi,3.)));
      float d=length(p-c0);
      float disc=smoothstep(rad,rad*.72,d)*(.55+.45*smoothstep(rad*.2,rad*.95,d));
      vec3 tint=fi<4.?VIOLET2:(fi<7.?CYAN:PINK);
      col+=tint*disc*(.045+.035*h(vec2(fi,7.)))*glass;
    }
  }
  // a soft vignette keeps the edges black, and a grain of one level hides banding
  col*=1.-.35*smoothstep(.55,1.25,length(p*vec2(1./asp*1.2,1.)));
  col+=(h(gl_FragCoord.xy+fract(t))-.5)/255.;
  gl_FragColor=vec4(col,1.);
}`;

/**
 * Draw the studio backdrop into a canvas at up to 60 fps.
 * @param {HTMLCanvasElement} canvas
 * @param {{scale?: number, glass?: number, focus?: [number, number, number], side?: number, pointer?: boolean, manual?: boolean}} [o]
 *   scale = render resolution relative to CSS pixels; focus = centre x, centre y and spread of the bokeh lights
 *   in units of the canvas height, origin at the centre.
 *   manual = no clock of its own: call draw(t) for each frame (used by the films in films/).
 * @returns {{destroy(): void, set(o: {glass?: number, focus?: [number, number, number], side?: number}): void, draw(t: number, pointer?: [number, number]): void}}
 */
export function mountLiquid(canvas, o = {}) {
  const opt = { scale: 0.5, glass: 1, focus: [0, 0, 1], side: 1, pointer: true, manual: false, ...o };
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: opt.manual ? 'high-performance' : 'low-power', preserveDrawingBuffer: opt.manual });
  const none = { destroy() {}, set() {}, draw() {} };
  if (!gl) return none;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
  } catch (e) {
    console.warn('liquid sky:', e);
    return none;
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['r', 't', 'm', 'glass', 'side', 'focus'].map((k) => [k, gl.getUniformLocation(prog, k)]));

  if (opt.manual) {
    // A film drives the clock itself: draw(t) paints exactly the frame of time t, and nothing runs in between.
    const draw = (t, pointer = [9, 9]) => {
      const w = Math.max(2, Math.round(canvas.clientWidth * opt.scale));
      const h = Math.max(2, Math.round(canvas.clientHeight * opt.scale));
      if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.r, w, h);
      gl.uniform1f(U.t, t + 12);
      gl.uniform2f(U.m, pointer[0], pointer[1]);
      gl.uniform1f(U.glass, opt.glass);
      gl.uniform1f(U.side, opt.side);
      gl.uniform3f(U.focus, opt.focus[0], opt.focus[1], opt.focus[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    return { destroy() {}, set: (next) => void Object.assign(opt, next), draw };
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The pointer drop rests off screen until the pointer arrives, then follows it with a little lag.
  const target = [9, 9];
  const mouse = [9, 9];
  const onMove = (e) => {
    const b = canvas.getBoundingClientRect();
    if (!b.height) return;
    target[0] = (e.clientX - b.left - b.width / 2) / b.height;
    target[1] = -(e.clientY - b.top - b.height / 2) / b.height;
    if (mouse[0] > 8) (mouse[0] = target[0]), (mouse[1] = target[1]);
  };
  if (opt.pointer && !still) window.addEventListener('pointermove', onMove, { passive: true });

  let visible = true;
  const io = new IntersectionObserver(([e]) => ((visible = e.isIntersecting), kick()));
  io.observe(canvas);
  let raf = 0;
  let dead = false;
  const t0 = performance.now();
  const frame = () => {
    raf = 0;
    if (dead) return;
    const w = Math.max(2, Math.round(canvas.clientWidth * opt.scale));
    const h = Math.max(2, Math.round(canvas.clientHeight * opt.scale));
    if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
    mouse[0] += (target[0] - mouse[0]) * 0.07;
    mouse[1] += (target[1] - mouse[1]) * 0.07;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.r, w, h);
    gl.uniform1f(U.t, still ? 12 : (performance.now() - t0) / 1000 + 12);
    gl.uniform2f(U.m, mouse[0], mouse[1]);
    gl.uniform1f(U.glass, opt.glass);
    gl.uniform1f(U.side, opt.side);
    gl.uniform3f(U.focus, opt.focus[0], opt.focus[1], opt.focus[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!still) kick();
  };
  function kick() {
    if (!raf && !dead && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => (still ? frame() : kick()));
  ro.observe(canvas);
  frame();
  return {
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    },
    set(next) {
      Object.assign(opt, next);
      if (still) frame();
    },
  };
}
