import * as THREE from 'three';
import {buildTree, makeSDF, meshAirway, findCarina, findSecondaryCarina, capsuleInfo} from './airway.js';

// ---------- anatomy ----------
const tree = buildTree();
const S = makeSDF(tree);
const B = tree.branches;
const CARINA = findCarina(tree, S);
const C2L = findSecondaryCarina(tree, S, 'LUL', 'LLL');
const DEPTH0 = 270 - (135 - CARINA[1]);            // incisors→carina ≈ 27 cm (adult)
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- renderer ----------
const canvas = document.getElementById('gl');
const viewEl = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(88, 1, 0.25, 260);
scene.add(camera);

const VERT = `
attribute float ring;
varying vec3 vPos; varying vec3 vN; varying float vRing;
void main(){ vPos=position; vN=normal; vRing=ring; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;
const FRAG = `
precision highp float;
uniform vec3 uCamPos; uniform vec3 uCamDir; uniform vec3 uBase; uniform vec3 uRingCol;
uniform float uVessel; uniform float uContact; uniform float uSpec; uniform float uGain;
varying vec3 vPos; varying vec3 vN; varying float vRing;
float hash(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
  vec3 N=normalize(vN); vec3 L=uCamPos-vPos; float d=length(L); L/=d;
  if(dot(N,L)<0.) N=-N;
  float ndl=max(dot(N,L),0.);
  float cone=0.25+0.75*smoothstep(0.30,0.85,dot(-L,uCamDir));
  float att=uGain/(1.0+0.0050*d*d);
  vec3 col=mix(uBase,uRingCol,clamp(vRing,0.,1.)*0.85);
  if(uVessel>0.){
    float m=noise(vPos*1.3); col*=0.88+0.22*m;
    float v1=1.-smoothstep(0.0,0.035,abs(noise(vPos*0.32)-0.5));
    float v2=1.-smoothstep(0.0,0.03,abs(noise(vPos*0.9+7.1)-0.5));
    col=mix(col,vec3(0.62,0.12,0.13),(v1*0.55+v2*0.3)*uVessel*(1.-0.6*clamp(vRing,0.,1.)));
  }
  float spec=(pow(ndl,70.)*0.65+pow(ndl,14.)*0.08)*uSpec;
  vec3 c=col*(0.02+ndl*cone*att)+vec3(1.0,0.97,0.93)*spec*cone*att;
  c=mix(c,vec3(0.55,0.06,0.05)*(0.4+0.6*ndl),uContact);
  c=c/(1.0+c*0.35);
  gl_FragColor=vec4(pow(c,vec3(1.0/2.2)),1.0);
}`;
const allMats = [];
function makeMat(base, opts = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: {
      uCamPos: {value: new THREE.Vector3()}, uCamDir: {value: new THREE.Vector3(0, 0, -1)},
      uBase: {value: new THREE.Color(...base)}, uRingCol: {value: new THREE.Color(...(opts.ring || base))},
      uVessel: {value: opts.vessel ?? 0}, uContact: {value: 0}, uSpec: {value: opts.spec ?? 1}, uGain: {value: opts.gain ?? 1.5},
    },
  });
  allMats.push(m); return m;
}
const mucosaMat = makeMat([0.84, 0.44, 0.41], {ring: [0.95, 0.78, 0.72], vessel: 1, spec: 1, gain: 1.3});
const tubeMat = makeMat([0.78, 0.83, 0.84], {spec: 1.6, gain: 1.15});
const tubeInMat = makeMat([0.62, 0.68, 0.70], {spec: 1.2, gain: 0.95});
const cuffMat = makeMat([0.16, 0.40, 0.95], {spec: 1.4, gain: 1.5});
const blackMat = makeMat([0.08, 0.08, 0.09], {spec: 0.6});

// ---------- scope state ----------
const scope = {
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(), trail: [], contact: 0,
  radius: 2.0,
};
const ctrl = {adv: 0, ret: 0, up: 0, down: 0, ccw: 0, cw: 0, fast: 0};
let mode = 'explore';            // 'explore' | 'dlt'
let lumen = 'trach';             // dlt lumen
let dlt = null;
let showLabels = true, showMap = true;

const fwd = () => new THREE.Vector3(0, 0, -1).applyQuaternion(scope.quat);
function orient(f, up) {
  // Matrix4.lookAt(eye,target,up) builds z = eye-target → camera -z = f
  scope.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), f.clone(), up));
}

function domain(x, y, z) {
  if (mode === 'dlt' && dlt) return lumen === 'trach' ? dlt.domTrach(x, y, z) : dlt.domBronch(x, y, z);
  return S.sdf(x, y, z);
}
function gradD(p) {
  const e = 0.06, x = p.x, y = p.y, z = p.z;
  const g = new THREE.Vector3(domain(x + e, y, z) - domain(x - e, y, z), domain(x, y + e, z) - domain(x, y - e, z), domain(x, y, z + e) - domain(x, y, z - e));
  const l = g.length(); return l > 1e-9 ? g.multiplyScalar(1 / l) : new THREE.Vector3(0, 1, 0);
}
function solve(p) {
  let hit = false; const R = scope.radius;
  for (let i = 0; i < 8; i++) {
    const d = domain(p.x, p.y, p.z);
    if (d <= -R) break;
    hit = true; p.addScaledVector(gradD(p), -(d + R + 0.005));
  }
  return hit;
}
function advance(dist) {
  const f = fwd(); const before = scope.pos.clone();
  scope.pos.addScaledVector(f, dist);
  const hit = solve(scope.pos);
  const moved = scope.pos.distanceTo(before);
  if (hit) {
    const g = gradD(scope.pos); const fd = f.dot(g);
    if (fd > 0) { // steer the tip away from the wall (wall sliding)
      const nf = f.clone().addScaledVector(g, -fd * 0.12).normalize();
      scope.quat.premultiply(new THREE.Quaternion().setFromUnitVectors(f, nf));
    }
    scope.contact = Math.min(1, scope.contact + (1 - moved / dist) * 0.25 + 0.02);
  }
  const last = scope.trail[scope.trail.length - 1];
  if (!last || last.distanceTo(scope.pos) > 0.5) scope.trail.push(before);
}
function retract(dist) {
  while (dist > 1e-6 && scope.trail.length) {
    const last = scope.trail[scope.trail.length - 1]; const dd = scope.pos.distanceTo(last);
    if (dd <= dist) { scope.pos.copy(last); scope.trail.pop(); dist -= dd; }
    else { scope.pos.lerp(last, dist / dd); dist = 0; }
  }
  solve(scope.pos);
}
function rotLocal(axis, ang) { scope.quat.multiply(new THREE.Quaternion().setFromAxisAngle(axis, ang)); }

// ---------- location / depth ----------
function locate(p) {
  const bi = S.nearest(p.x, p.y, p.z); const b = B[bi];
  const ci = capsuleInfo(b, p.x, p.y, p.z);
  const depth = DEPTH0 + b.cum + ci.t * b.len;
  let name = `${b.name} (${b.ko})`;
  if ((b.id === 'TR' && p.y < CARINA[1] + 18) || ((b.id === 'RMB' || b.id === 'LMB') && ci.t < 0.4 && p.y > CARINA[1] - 1)) name = 'Carina 부근 (기관 원위부)';
  if ((b.id === 'LUL' || b.id === 'LLL') && ci.t < 0.15 || b.id === 'LMB' && ci.t > 0.9) name = 'LUL/LLL 분기부 (좌측 2차 carina)';
  if ((b.id === 'RML' || b.id === 'RLL') && ci.t < 0.1 || b.id === 'BI' && ci.t > 0.9) name = 'RML/RLL 분기부';
  if (b.id === 'RMB' && ci.t > 0.75) name = 'RUL 입구 / 중간기관지 분기부';
  return {b, t: ci.t, depth, name};
}

// ---------- airway mesh ----------
let airwayMesh = null;
function buildAirway() {
  const M = meshAirway(tree, S, 0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(M.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(M.normals, 3));
  g.setAttribute('ring', new THREE.BufferAttribute(M.ring, 1));
  g.setIndex(new THREE.BufferAttribute(M.indices, 1));
  airwayMesh = new THREE.Mesh(g, mucosaMat); airwayMesh.frustumCulled = false;
  scene.add(airwayMesh);
}

// ---------- tube geometry helper ----------
function tubeGeometry(path, s0, s1, radiusFn, skipFn) {
  const RS = 40; const step = 0.5;
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const pos = [], nor = [], ind = [];
  for (let i = 0; i < n; i++) {
    const s = s0 + (s1 - s0) * i / (n - 1); const fr = path.frame(s); const r = radiusFn(s);
    for (let j = 0; j <= RS; j++) {
      const a = j / RS * Math.PI * 2; const c = Math.cos(a), sn = Math.sin(a);
      const nx = fr.n.x * c + fr.b.x * sn, ny = fr.n.y * c + fr.b.y * sn, nz = fr.n.z * c + fr.b.z * sn;
      pos.push(fr.p.x + nx * r, fr.p.y + ny * r, fr.p.z + nz * r); nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < RS; j++) {
    const s = s0 + (s1 - s0) * (i + 0.5) / (n - 1); const a = (j + 0.5) / RS * Math.PI * 2;
    if (skipFn && skipFn(s, a)) continue;
    const a0 = i * (RS + 1) + j, a1 = a0 + 1, b0 = a0 + RS + 1, b1 = b0 + 1;
    ind.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('ring', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(ind); return g;
}
function annulus(center, axis, r0, r1) {
  const g = new THREE.RingGeometry(r0, r1, 40, 1);
  g.setAttribute('ring', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  const m = new THREE.Mesh(g, tubeMat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); m.position.copy(center);
  return m;
}

// Path with arclength sampling + parallel-transport frames
function makePath(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(V3), false, 'centripetal');
  const len = curve.getLength(); const ds = 0.5; const n = Math.ceil(len / ds) + 1;
  const P = curve.getSpacedPoints(n - 1); const T = [];
  for (let i = 0; i < n; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; T.push(b.clone().sub(a).normalize()); }
  const N = [], Bn = []; let nrm = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    nrm = nrm.clone().addScaledVector(T[i], -nrm.dot(T[i])).normalize();
    N.push(nrm); Bn.push(T[i].clone().cross(nrm).normalize());
  }
  const step = len / (n - 1);
  const idx = (s) => Math.min(n - 1, Math.max(0, Math.round(s / step)));
  return {
    P, T, N, Bn, len, step, n,
    frame(s) { const i = idx(s); return {p: P[i], t: T[i], n: N[i], b: Bn[i]}; },
    sAt(i) { return i * step; },
    nearest(p, maxI) { // nearest sample index up to maxI
      let best = 1e9, bi = 0; for (let i = 0; i <= maxI; i += 2) { const d = P[i].distanceToSquared(p); if (d < best) { best = d; bi = i; } }
      const lo = Math.max(0, bi - 2), hi = Math.min(maxI, bi + 2);
      for (let i = lo; i <= hi; i++) { const d = P[i].distanceToSquared(p); if (d < best) { best = d; bi = i; } }
      return bi;
    },
    firstBelowY(y) { for (let i = 0; i < n; i++) if (P[i].y <= y) return i * step; return 0; },
    closestTo(pt) { let best = 1e9, bi = 0; for (let i = 0; i < n; i++) { const d = P[i].distanceToSquared(pt); if (d < best) { best = d; bi = i; } } return bi * step; },
  };
}
function branchPts(id, ss) { const b = tree.map[id]; return ss.map(s => [b.a[0] + b.dir[0] * s, b.a[1] + b.dir[1] * s, b.a[2] + b.dir[2] * s]); }

// ---------- DLT cases ----------
const R_OUT = 3.6, R_IN = 2.75, MAIN_OUT = 6.9, MAIN_IN = 6.1;
function buildDLT(cs) {
  const group = new THREE.Group();
  const side = cs.side;                       // bronchus that the bronchial limb enters
  const sx = side === 'L' ? 1 : -1;
  const ox = 2.4 * sx;
  const mkPath = (dl) => {
    const portY = Math.max(CARINA[1] + 4, CARINA[1] + 15 - dl * 0.95);
    let pts = [[ox, 200, 0], [ox, 80, 0], [ox, portY + 1, 0]];
    const latY = Math.min(portY - 9, CARINA[1] + 18);
    if (latY > CARINA[1] + 8) pts.push([5.0 * sx, latY, -0.3]);
    if (side === 'L') {
      pts = pts.concat(branchPts('LMB', [16, 24, 32, 40, 48, 54]));
      pts = pts.concat(cs.deepTo === 'LUL' ? branchPts('LUL', [4, 8, 12]).concat(branchPts('LUD', [4, 8])) : branchPts('LLL', [4, 8, 12, 16, 18]).concat(branchPts('LB9', [5])));
    } else {
      pts = pts.concat(branchPts('RMB', [12, 18, 24, 27])).concat(branchPts('BI', [5, 10, 15, 20, 24])).concat(branchPts('RLL', [5, 10, 15]));
    }
    return {portY, path: makePath(pts)};
  };
  if (cs.kind === 'deep' && cs.tube === 'L' && cs.delta === undefined) {
    const pre = mkPath(25); const sC = pre.path.firstBelowY(CARINA[1]); const sC2 = pre.path.closestTo(V3(C2L));
    cs.delta = Math.max(20, Math.round((sC2 + 7 - (sC + 22)) / 5) * 5);
  }
  const {portY, path} = mkPath(cs.kind === 'wrong' ? 0 : (cs.delta || 0));
  const sCar = path.firstBelowY(CARINA[1]);
  let tip, cuff, slot = null;
  if (cs.tube === 'L') {
    if (side === 'L') {
      tip = sCar + 22 + cs.delta;
    } else tip = sCar + 22 + 4;               // wrong side: cuff straddles RUL take-off
    cuff = [tip - 18, tip - 6];
  } else { // right DLT
    const sRUL = path.closestTo(V3(tree.map.RUL.a));
    tip = sRUL + 12 + cs.delta;
    cuff = [tip - 22, tip - 3];
    slot = {s0: tip - 17.5, s1: tip - 6.5};
    const fr = path.frame(sRUL); const rd = V3(tree.map.RUL.dir);
    slot.ang = Math.atan2(rd.dot(fr.b), rd.dot(fr.n));
  }
  const tipI = Math.round(tip / path.step);
  const angDiff = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
  const inSlot = (s, a) => slot && s > slot.s0 && s < slot.s1 && angDiff(a, slot.ang) < 0.75;
  // cuff radius follows the airway (seals) — herniates where the airway is wide
  const cuffR = (s) => {
    if (s < cuff[0] || s > cuff[1]) return R_OUT;
    const u = (s - cuff[0]) / (cuff[1] - cuff[0]);
    const p = path.frame(s).p; const free = -S.sdf(p.x, p.y, p.z);
    const rc = Math.min(Math.max(free + 0.35, R_OUT + 0.8), 6.2);
    return R_OUT + (rc - R_OUT) * Math.pow(Math.sin(Math.PI * u), 0.45);
  };
  // meshes
  group.add(new THREE.Mesh(tubeGeometry(path, 0, tip, () => R_OUT, inSlot), tubeMat));
  group.add(new THREE.Mesh(tubeGeometry(path, 0, tip, () => R_IN, inSlot), tubeInMat));
  const ft = path.frame(tip); group.add(annulus(ft.p, ft.t, R_IN, R_OUT));
  const stripeAng = 0; // radiopaque line (anterior)
  group.add(new THREE.Mesh(tubeGeometry(path, 0, tip - 0.5, () => R_OUT + 0.03, (s, a) => angDiff(a, stripeAng) > 0.06 || inSlot(s, a) || (s > cuff[0] && s < cuff[1])), blackMat));
  const cuffSkip = slot ? (s, a) => s > slot.s0 - 1.5 && s < slot.s1 + 1.5 && angDiff(a, slot.ang) < 1.0 : null;
  group.add(new THREE.Mesh(tubeGeometry(path, cuff[0], cuff[1], cuffR, cuffSkip), cuffMat));
  if (slot) { // dark rim marking the RUL ventilation slot
    for (const s of [slot.s0, slot.s1]) {
      const fr = path.frame(s); const d = fr.n.clone().multiplyScalar(Math.cos(slot.ang)).addScaledVector(fr.b, Math.sin(slot.ang));
      const g = new THREE.SphereGeometry(0.45, 8, 6); g.setAttribute('ring', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
      const m = new THREE.Mesh(g, blackMat); m.position.copy(fr.p).addScaledVector(d, R_OUT); group.add(m);
    }
  }
  // main body (tracheal lumen) — straight tube in trachea ending at the tracheal port
  const mainPath = makePath([[0, 200, 0], [0, 120, 0], [0, portY, 0]]);
  group.add(new THREE.Mesh(tubeGeometry(mainPath, 0, mainPath.len, () => MAIN_OUT), tubeMat));
  group.add(new THREE.Mesh(tubeGeometry(mainPath, 0, mainPath.len, () => MAIN_IN), tubeInMat));
  group.add(annulus(new THREE.Vector3(0, portY, 0), new THREE.Vector3(0, -1, 0), MAIN_IN, MAIN_OUT));
  group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });

  const tipP = ft.p.clone(), tipT = ft.t.clone();
  const tmp = new THREE.Vector3();
  function limbSolid(x, y, z) { // signed distance to bronchial limb solid (incl. cuff)
    tmp.set(x, y, z); const i = path.nearest(tmp, tipI); const s = i * path.step;
    return path.P[i].distanceTo(tmp) - cuffR(s);
  }
  function domTrach(x, y, z) {
    if (y > portY) return Math.max(Math.hypot(x, z) - MAIN_IN, -limbSolid(x, y, z));
    return Math.max(S.sdf(x, y, z), -limbSolid(x, y, z));
  }
  function domBronch(x, y, z) {
    tmp.set(x, y, z); const i = path.nearest(tmp, tipI);
    const beyond = i >= tipI - 1 && tmp.clone().sub(tipP).dot(tipT) > 0;
    if (beyond) return S.sdf(x, y, z);
    return path.P[i].distanceTo(tmp) - R_IN;
  }
  function insideTube(p) {
    if (lumen === 'trach') return p.y > portY ? 'DLT 기관 내강 안' : null;
    const i = path.nearest(p, tipI); const beyond = i >= tipI - 1 && p.clone().sub(tipP).dot(tipT) > 0;
    return beyond ? null : 'DLT 기관지 내강 안';
  }
  const startTrach = {pos: new THREE.Vector3(-3.2 * sx, Math.max(portY - 4, CARINA[1] + 11), 0.5), f: new THREE.Vector3(0.35 * sx, -1, 0).normalize(), from: new THREE.Vector3(-3.4 * sx, portY + 12, 0)};
  const sb = Math.max(sCar - 30, tip - 15); const fb = path.frame(sb);
  const startBronch = {pos: fb.p.clone(), f: fb.t.clone(), from: path.frame(Math.max(0, sb - 15)).p.clone()};
  return {group, path, tip, cuff, slot, portY, sCar, domTrach, domBronch, insideTube, startTrach, startBronch, cs};
}

const CASES_L = [
  {w: 24, tube: 'L', side: 'L', kind: 'ok', delta: 0},
  {w: 10, tube: 'L', side: 'L', kind: 'shallow', delta: -8},
  {w: 10, tube: 'L', side: 'L', kind: 'shallow', delta: -12},
  {w: 14, tube: 'L', side: 'L', kind: 'deep', deepTo: 'LLL'},
  {w: 9, tube: 'L', side: 'L', kind: 'deep', deepTo: 'LUL'},
  {w: 14, tube: 'L', side: 'R', kind: 'wrong', delta: 0},
];
const CASES_R = [
  {w: 10, tube: 'R', side: 'R', kind: 'ok', delta: 0},
  {w: 8, tube: 'R', side: 'R', kind: 'deep', delta: 10},
  {w: 8, tube: 'R', side: 'R', kind: 'shallow', delta: -8},
];
function pickCase() {
  const pool = CASES_L.concat(document.getElementById('optRight').checked ? CASES_R : []);
  let tot = pool.reduce((a, c) => a + c.w, 0), r = Math.random() * tot;
  for (const c of pool) { r -= c.w; if (r <= 0) return {...c}; }
  return {...pool[0]};
}

// ---------- UI refs ----------
const $ = (id) => document.getElementById(id);
const hudLoc = $('hudLoc'), hudDepth = $('hudDepth'), hudExtra = $('hudExtra');
const contactEl = $('contact'); const mapCv = $('minimap'); const mctx = mapCv.getContext('2d');
const maskEl = $('mask'); const labelsEl = $('labels');

// ---------- labels ----------
const labelDefs = [];
for (const b of B) {
  if (b.id === 'TR') continue;
  const off = b.level === 1 ? 15 : Math.min(4, b.len * 0.3);
  labelDefs.push({p: new THREE.Vector3(b.a[0] + b.dir[0] * off, b.a[1] + b.dir[1] * off, b.a[2] + b.dir[2] * off),
    text: b.level === 3 ? b.name.split(' ')[0] + ' ' + b.ko : `${b.name.replace(' bronchus', '')} · ${b.ko}`, cls: b.level === 3 ? 'seg' : ''});
}
labelDefs.push({p: V3(CARINA).add(new THREE.Vector3(0, 1.0, 0.5)), text: 'Carina', cls: 'car'});
labelDefs.push({p: V3(C2L), text: '2차 carina (LUL/LLL)', cls: 'car'});
for (const L of labelDefs) { L.el = document.createElement('div'); L.el.className = 'lbl ' + L.cls; L.el.textContent = L.text; L.el.style.display = 'none'; labelsEl.appendChild(L.el); }
function visibleLine(a, b) {
  const d = b.clone().sub(a); const len = d.length(); d.multiplyScalar(1 / len);
  const p = new THREE.Vector3();
  for (let s = 1.0; s < len - 1.5; s += 1.2) { p.copy(a).addScaledVector(d, s); if (domain(p.x, p.y, p.z) > 0.25) return false; }
  return true;
}
let viewW = 1, viewH = 1, maskR = 1;
function updateLabels() {
  if (!showLabels) { for (const L of labelDefs) L.el.style.display = 'none'; return; }
  const cp = scope.pos; const f = fwd(); const v = new THREE.Vector3(); const placed = [];
  const order = labelDefs.map(L => [L, L.p.distanceToSquared(cp)]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  for (const L of order) {
    const rel = L.p.clone().sub(cp); const dist = rel.length();
    let show = dist < 60 && dist > 2 && rel.dot(f) > dist * 0.25;
    if (show) { v.copy(L.p).project(camera); const x = (v.x * 0.5 + 0.5) * viewW, y = (-v.y * 0.5 + 0.5) * viewH;
      if (Math.hypot(x - viewW / 2, y - viewH / 2) > maskR * 0.92) show = false;
      else if (placed.some(q => Math.abs(q[0] - x) < 70 && Math.abs(q[1] - y) < 18)) show = false;
      else if (!visibleLine(cp, L.p)) show = false;
      else { placed.push([x, y]); L.el.style.left = x + 'px'; L.el.style.top = y + 'px'; L.el.style.opacity = String(Math.max(0.35, 1 - dist / 80)); }
    }
    L.el.style.display = show ? 'block' : 'none';
  }
}

// ---------- minimap (coronal, viewer facing patient: patient's right on the left) ----------
function drawMap(loc) {
  if (!showMap) return;
  const W = mapCv.width, H = mapCv.height; mctx.clearRect(0, 0, W, H);
  const sc = 1.0, cx = W / 2, cy = 70;
  const X = (x) => cx + x * sc, Y = (y) => cy - (y - 60) * sc * 0.82;
  mctx.lineCap = 'round';
  for (const b of B) {
    const hideCur = mode === 'dlt' && !answered;
    mctx.strokeStyle = (loc && loc.b === b && !hideCur) ? '#7ee787' : (visited.has(b.id) ? '#c98a87' : '#6e5656');
    mctx.lineWidth = Math.max(1.2, (b.r0 + b.r1) * sc * 0.8);
    mctx.beginPath(); mctx.moveTo(X(b.a[0]), Y(b.a[1])); mctx.lineTo(X(b.b[0]), Y(b.b[1])); mctx.stroke();
  }
  if (mode === 'dlt' && dlt && dlt.revealed) {
    const P = dlt.path.P; const ti = Math.round(dlt.tip / dlt.path.step);
    mctx.strokeStyle = 'rgba(230,237,243,.9)'; mctx.lineWidth = 2.5; mctx.beginPath();
    for (let i = 0; i <= ti; i += 4) { const p = P[i]; if (i === 0) mctx.moveTo(X(p.x), Y(p.y)); else mctx.lineTo(X(p.x), Y(p.y)); }
    mctx.stroke();
    mctx.strokeStyle = '#388bfd'; mctx.lineWidth = 5; mctx.beginPath();
    for (let i = Math.round(dlt.cuff[0] / dlt.path.step); i <= Math.round(dlt.cuff[1] / dlt.path.step); i += 2) { const p = P[i]; mctx.lineTo(X(p.x), Y(p.y)); }
    mctx.stroke();
    mctx.fillStyle = '#ffa657'; mctx.fillRect(X(0) - 7, Y(dlt.portY) - 1.5, 14, 3);
  }
  const p = scope.pos, f = fwd();
  if (mode === 'dlt' && !answered) { mctx.fillStyle = '#8b949e'; mctx.font = '10px sans-serif'; mctx.fillText('제출 후 위치 공개', W / 2 - 38, H - 18); mctx.fillText('R', 6, H - 6); mctx.fillText('L', W - 12, H - 6); return; }
  mctx.fillStyle = '#ff7b72'; mctx.beginPath(); mctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2); mctx.fill();
  mctx.strokeStyle = '#ff7b72'; mctx.lineWidth = 2; mctx.beginPath(); mctx.moveTo(X(p.x), Y(p.y)); mctx.lineTo(X(p.x + f.x * 14), Y(p.y + f.y * 14)); mctx.stroke();
  mctx.fillStyle = '#8b949e'; mctx.font = '10px sans-serif'; mctx.fillText('R', 6, H - 6); mctx.fillText('L', W - 12, H - 6); mctx.fillText('관상면', W / 2 - 14, H - 6);
}

// ---------- explore: visited segments ----------
const visited = new Set();
const segIds = tree.terminal.map(b => b.id);
function renderVisits() {
  $('visitCount').textContent = `${segIds.filter(i => visited.has(i)).length} / ${segIds.length}`;
  $('visitList').innerHTML = segIds.map(id => `<span class="${visited.has(id) ? 'v' : ''}">${id.replace('LB12', 'LB1+2').replace('LB8', 'LB7+8')}</span>`).join('');
}

// ---------- modes ----------
function resetExplore() {
  mode = 'explore'; scope.radius = 2.0; scope.trail = [];
  scope.pos.set(0, 112, 0); orient(new THREE.Vector3(0, -1, 0.0), new THREE.Vector3(0, 0, 1));
  if (dlt) { scene.remove(dlt.group); }
  hudExtra.textContent = '';
}
function setLumen(l) {
  lumen = l; scope.radius = 1.35; scope.trail = [];
  const st = l === 'trach' ? dlt.startTrach : dlt.startBronch;
  scope.pos.copy(st.pos); orient(st.f.clone(), new THREE.Vector3(0, 0, 1)); solve(scope.pos);
  // breadcrumb trail so that 후퇴 pulls the scope back up into the lumen
  if (st.from) { const n = Math.ceil(st.from.distanceTo(scope.pos) / 0.5); for (let i = 0; i < n; i++) scope.trail.push(st.from.clone().lerp(scope.pos, i / n)); }
  $('btnTrach').classList.toggle('active', l === 'trach'); $('btnBronch').classList.toggle('active', l === 'bronch');
}
let caseNo = 0, score = 0, maxScore = 0, answered = false, sel = {dx: null, act: null};
function newCase() {
  if (dlt) scene.remove(dlt.group);
  const cs = pickCase(); dlt = buildDLT(cs); dlt.revealed = false; scene.add(dlt.group);
  caseNo++; answered = false; sel = {dx: null, act: null};
  $('caseNo').textContent = `· 증례 ${caseNo}`;
  const fr = [35, 37, 39, 41][Math.floor(Math.random() * 4)];
  $('caseInfo').innerHTML = `<b>${cs.tube === 'L' ? '좌측' : '우측'} DLT ${fr} Fr</b> — ${cs.tube === 'L' ? '좌측 주기관지 삽관 목표' : '우측 주기관지 삽관 목표 (좌측 전폐절제 예정)'}. 맹목 삽관 후 청진 소견이 애매합니다. 두 내강으로 기관지경을 넣어 위치를 확인하세요.`;
  for (const b of document.querySelectorAll('#dxChips button,#actChips button')) b.className = '';
  $('feedback').classList.add('hidden'); $('btnSubmit').disabled = false;
  setLumen('trach');
}
function enterDLT() {
  mode = 'dlt'; if (showLabels) toggleLabels(); $('tabDLT').classList.add('active'); $('tabExplore').classList.remove('active');
  $('panelDLT').classList.remove('hidden'); $('panelExplore').classList.add('hidden');
  newCase();
}
function enterExplore() {
  $('tabExplore').classList.add('active'); $('tabDLT').classList.remove('active');
  $('panelExplore').classList.remove('hidden'); $('panelDLT').classList.add('hidden');
  resetExplore();
}

// ---------- DLT grading ----------
function truth(cs) {
  if (cs.kind === 'ok') return {dx: 'ok', act: 'keep'};
  if (cs.kind === 'shallow') return {dx: 'shallow', act: 'advance', amt: Math.abs(cs.delta) / 10};
  if (cs.kind === 'deep') return {dx: 'deep', act: 'withdraw', amt: cs.delta / 10};
  return {dx: 'wrong', act: 'reposition'};
}
function explain(cs, T) {
  const amt = T.amt ? T.amt.toFixed(1) : '';
  const L = {
    ok: `<b>정위치.</b> 기관 내강 시야: carina가 날카롭게 보이고 우주기관지 입구가 열려 있으며, 좌주기관지로 들어간 기관지 분지의 <b>파란 기관지 커프 근위 경계가 carina 바로 아래(수 mm)</b>에 살짝 보입니다(탈출 없음). 기관지 내강 시야: 튜브 끝 너머로 <b>LUL·LLL 분기(2차 carina)가 모두 개통</b>되어 보입니다. → 조정 불필요. 체위 변경(측와위) 후 반드시 재확인.`,
    shallow: `<b>너무 얕음.</b> 기관 내강 시야에서 파란 커프가 <b>carina 위로 탈출(herniation)</b>하여 carina와 우주기관지 입구를 일부 가립니다. 분리 실패·우측(환기측) 기도 부분 폐쇄 위험. 기관지 내강 끝은 좌주기관지 입구 근처에 겨우 걸쳐 있습니다. → 기관지 커프 수축 후 기관지경으로 보면서 <b>약 ${amt} cm 전진</b>, 커프 근위 경계가 carina 바로 아래 보이면 재팽창.`,
    deep: `<b>너무 깊음.</b> 기관 내강 시야에서 <b>파란 커프가 보이지 않고</b> 기관 내강 개구부가 carina에 근접합니다. 기관지 내강 시야에서 2차 carina가 보이지 않고 ${cs.deepTo === 'LUL' ? '상엽(LUL) 쪽만 보이며 <b>LLL 입구가 튜브에 막혀</b> 있습니다' : '하엽(LLL)만 보이며 <b>LUL 입구가 튜브/커프에 막혀</b> 있습니다'} → 해당 엽 무환기로 OLV 중 저산소증 위험. → 커프 수축 후 <b>약 ${amt} cm 후퇴</b>, 기관 내강에서 파란 커프 경계가 carina 바로 아래 보일 때까지.`,
    wrong: `<b>반대쪽(우주기관지) 삽관.</b> 기관 내강 시야에서 기관지 분지와 파란 커프가 <b>우주기관지</b>로 들어가 있고 좌주기관지 입구는 비어 있습니다. 기관지 내강 시야에서는 중간기관지와 RML/RLL 분기가 보이고, 짧은 우주기관지 때문에 <b>RUL 입구가 커프로 막힙니다</b>. → 두 커프 모두 수축 → 튜브를 carina 위(기관)까지 후퇴 → 기관지경을 기관지 내강으로 좌주기관지까지 넣고 그 위로 튜브를 밀어 넣어(railroad) 재위치 → 재확인.`,
  };
  const R = {
    ok: `<b>우측 DLT 정위치.</b> 기관 내강 시야: 파란 커프가 우주기관지 입구 바로 아래 보입니다. 기관지 내강 시야: 내시경을 측방으로 굴곡하면 <b>RUL 환기구(slot)를 통해 RUL 입구가 정렬</b>되어 보이고, 끝 너머로 중간기관지(RML/RLL)가 개통되어 있습니다. RUL 분지가 carina에서 약 1.5–2.5 cm로 짧아 안전역이 작으므로 체위 변경 후 재확인 필수.`,
    deep: `<b>우측 DLT 너무 깊음.</b> slot이 RUL 입구보다 아래에 있어 slot으로는 중간기관지 벽만 보이고 <b>RUL 입구는 튜브 벽/커프에 막혀</b> 있습니다. 기관 내강에서 커프가 잘 보이지 않습니다. → 커프 수축 후 <b>약 ${amt} cm 후퇴</b>하여 slot을 RUL 입구에 맞춤.`,
    shallow: `<b>우측 DLT 너무 얕음.</b> 기관 내강 시야에서 파란 커프가 carina 쪽으로 탈출하고, 기관지 내강의 slot이 RUL 입구보다 위(우주기관지 벽)를 향합니다. → 커프 수축 후 <b>약 ${amt} cm 전진</b>, slot과 RUL 입구 정렬 확인.`,
  };
  return (cs.tube === 'L' ? L : R)[cs.kind] + `<div class="muted small" style="margin-top:6px">참고: Miller's Anesthesia(흉부마취 장) DLT 위치 확인 원칙을 바탕으로 한 교육용 요약입니다. 실제 임상에서는 청진·기도압·체위 변경 후 재확인을 함께 시행하세요.</div>`;
}
function submit() {
  if (answered || !dlt) return;
  if (!sel.dx || !sel.act) { $('feedback').classList.remove('hidden'); $('feedback').innerHTML = '진단과 조치를 모두 선택하세요.'; return; }
  answered = true; dlt.revealed = true;
  const T = truth(dlt.cs); const amt = parseFloat($('amt').value);
  let pts = 0, max = 2; const okDx = sel.dx === T.dx, okAct = sel.act === T.act; let okAmt = true;
  if (okDx) pts++; if (okAct) pts++;
  if (T.amt) { max = 3; okAmt = okAct && Math.abs(amt - T.amt) <= 0.5 + 1e-6; if (okAmt) pts++; }
  score += pts; maxScore += max; $('score').textContent = `${score} / ${maxScore}`;
  for (const b of document.querySelectorAll('#dxChips button')) { if (b.dataset.v === T.dx) b.className = 'right'; else if (b.dataset.v === sel.dx) b.className = 'wrongsel'; }
  for (const b of document.querySelectorAll('#actChips button')) { if (b.dataset.v === T.act) b.className = 'right'; else if (b.dataset.v === sel.act) b.className = 'wrongsel'; }
  const fb = $('feedback'); fb.classList.remove('hidden');
  fb.innerHTML = `<div class="res ${pts === max ? 'ok' : 'bad'}">${pts === max ? '정답!' : '오답 / 부분 정답'} (+${pts}/${max})</div>` +
    (T.amt ? `<div>정답 거리: 약 ${T.amt.toFixed(1)} cm ${okAmt ? '✓' : `(선택: ${amt.toFixed(1)} cm)`}</div>` : '') +
    `<div style="margin-top:6px">${explain(dlt.cs, T)}</div><div class="muted small" style="margin-top:6px">미니맵에 실제 튜브 위치(흰색: 기관지 분지, 파랑: 커프, 주황: 기관 내강 개구부)가 표시됩니다.</div>`;
  $('btnSubmit').disabled = true;
  fb.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

// ---------- input ----------
for (const btn of document.querySelectorAll('.hold')) {
  const act = btn.dataset.act;
  const on = (e) => { e.preventDefault(); ctrl[act] = 1; btn.classList.add('pressed'); try { btn.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = (e) => { ctrl[act] = 0; btn.classList.remove('pressed'); };
  btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('lostpointercapture', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
const keymap = {ArrowUp: 'adv', ArrowDown: 'ret', KeyW: 'up', KeyS: 'down', ArrowLeft: 'ccw', ArrowRight: 'cw', KeyA: 'ccw', KeyD: 'cw'};
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (keymap[e.code]) { ctrl[keymap[e.code]] = 1; e.preventDefault(); }
  if (e.shiftKey) ctrl.fast = 1;
  if (e.code === 'KeyL') toggleLabels(); if (e.code === 'KeyM') toggleMap();
});
window.addEventListener('keyup', (e) => { if (keymap[e.code]) ctrl[keymap[e.code]] = 0; if (!e.shiftKey) ctrl.fast = 0; });
window.addEventListener('blur', () => { for (const k in ctrl) ctrl[k] = 0; });
let drag = null;
viewEl.addEventListener('pointerdown', (e) => { drag = {x: e.clientX, y: e.clientY, id: e.pointerId}; try { viewEl.setPointerCapture(e.pointerId); } catch (_) {} });
viewEl.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  rotLocal(new THREE.Vector3(1, 0, 0), dy * 0.005);    // drag down → tip flexes up (content follows finger)
  rotLocal(new THREE.Vector3(0, 0, 1), dx * 0.005);
});
const endDrag = () => { drag = null; };
viewEl.addEventListener('pointerup', endDrag); viewEl.addEventListener('pointercancel', endDrag);
viewEl.addEventListener('wheel', (e) => { e.preventDefault(); const d = -e.deltaY * 0.04; if (d > 0) advance(Math.min(d, 4)); else retract(Math.min(-d, 4)); }, {passive: false});
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.target.closest('#side')) return; e.preventDefault(); }, {passive: false});

function toggleLabels() { showLabels = !showLabels; $('btnLabels').classList.toggle('on', showLabels); }
function toggleMap() { showMap = !showMap; $('btnMap').classList.toggle('on', showMap); mapCv.style.display = showMap ? 'block' : 'none'; }
$('btnLabels').onclick = toggleLabels; $('btnMap').onclick = toggleMap;
$('btnReset').onclick = () => { if (mode === 'explore') resetExplore(); else setLumen(lumen); };
$('btnHelp').onclick = () => $('help').classList.remove('hidden');
$('btnHelpClose').onclick = () => $('help').classList.add('hidden');
$('tabExplore').onclick = enterExplore; $('tabDLT').onclick = enterDLT;
$('btnTrach').onclick = () => setLumen('trach'); $('btnBronch').onclick = () => setLumen('bronch');
for (const id of ['dxChips', 'actChips']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || answered) return;
    for (const o of $(id).querySelectorAll('button')) o.classList.remove('on');
    b.classList.add('on'); sel[id === 'dxChips' ? 'dx' : 'act'] = b.dataset.v;
    if (id === 'actChips') $('amtRow').style.opacity = (b.dataset.v === 'advance' || b.dataset.v === 'withdraw') ? '1' : '0.35';
  });
}
$('btnSubmit').onclick = submit; $('btnNext').onclick = newCase;

// ---------- resize ----------
function resize() {
  const r = viewEl.getBoundingClientRect(); viewW = Math.max(1, r.width); viewH = Math.max(1, r.height);
  renderer.setSize(viewW, viewH, false); camera.aspect = viewW / viewH; camera.updateProjectionMatrix();
  maskR = Math.min(viewW, viewH) * 0.48; maskEl.style.width = maskEl.style.height = (maskR * 2) + 'px';
}
window.addEventListener('resize', resize); new ResizeObserver(resize).observe(viewEl);

// ---------- loop ----------
let lastT = performance.now(), frame = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; frame++;
  const sp = (ctrl.fast ? 30 : 13) * dt;
  if (ctrl.adv) advance(sp); if (ctrl.ret) retract(sp);
  const fl = 0.9 * dt, tw = 1.2 * dt;
  if (ctrl.up) rotLocal(new THREE.Vector3(1, 0, 0), fl); if (ctrl.down) rotLocal(new THREE.Vector3(1, 0, 0), -fl);
  if (ctrl.ccw) rotLocal(new THREE.Vector3(0, 0, 1), tw); if (ctrl.cw) rotLocal(new THREE.Vector3(0, 0, 1), -tw);
  if (!ctrl.adv) scope.contact *= Math.pow(0.02, dt);
  scope.quat.normalize();
  camera.position.copy(scope.pos); camera.quaternion.copy(scope.quat); camera.updateMatrixWorld();
  const f = fwd();
  for (const m of allMats) { m.uniforms.uCamPos.value.copy(scope.pos); m.uniforms.uCamDir.value.copy(f); m.uniforms.uContact.value = Math.min(0.75, scope.contact); }
  renderer.render(scene, camera);
  if (frame % 4 === 0) {
    const loc = locate(scope.pos);
    const inTube = mode === 'dlt' && dlt ? dlt.insideTube(scope.pos) : null;
    const hide = mode === 'dlt' && !answered;   // don't give the answer away before submission
    hudLoc.textContent = hide ? (inTube || '튜브 밖 (위치명은 제출 후 공개)') : (inTube ? `${inTube} — ${loc.name}` : loc.name);
    hudDepth.textContent = (loc.depth / 10).toFixed(1) + ' cm';
    if (mode === 'explore' && loc.b.level === 3 && loc.t > 0.25 && !visited.has(loc.b.id)) { visited.add(loc.b.id); renderVisits(); }
    if (mode === 'explore' && loc.b.level < 3 && loc.t > 0.3) visited.add(loc.b.id);
    if (mode === 'dlt') hudExtra.textContent = lumen === 'trach' ? '보는 경로: 기관 내강' : '보는 경로: 기관지 내강';
    contactEl.style.opacity = scope.contact > 0.25 ? '1' : '0';
    drawMap(loc); updateLabels();
  }
  requestAnimationFrame(tick);
}

// ---------- boot ----------
window.__sim = {scope, advance, retract, rotLocal, setLumen, enterDLT, enterExplore, newCase, get dlt() { return dlt; }, THREE, tree, CARINA, C2L, orient, solve, buildDLT, pickCase,
  setCase(c) { if (dlt) scene.remove(dlt.group); dlt = buildDLT(c); dlt.revealed = false; scene.add(dlt.group); setLumen('trach'); answered = false; }, submit, sel: () => sel, locate};
resize();
requestAnimationFrame(() => setTimeout(() => {
  const t0 = performance.now(); buildAirway(); console.log('airway mesh ms', Math.round(performance.now() - t0));
  resetExplore(); renderVisits(); $('loading').classList.add('hidden'); requestAnimationFrame(tick);
}, 30));
