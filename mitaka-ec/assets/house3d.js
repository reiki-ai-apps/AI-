// パイプハウス 3Dビュー(three.js)
// createViewer(container) → { update(est), setView(name), setLabels(on), screenshot(), dispose() }
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const V3 = THREE.Vector3;
const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0xc8cdd2, metalness: 0.55, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.3, roughness: 0.6 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x8fae6e, roughness: 1 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x6b5137, roughness: 1 }),
  ridgeSoil: new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }),
  net: new THREE.MeshStandardMaterial({ color: 0x1f2937, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
  curtain: new THREE.MeshStandardMaterial({ color: 0xf5f5f0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false }),
  hose: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }),
  nozzle: new THREE.MeshStandardMaterial({ color: 0xff7f2a, roughness: 0.6 }),
  legs: new THREE.MeshStandardMaterial({ color: 0x374151 }),
  torso: new THREE.MeshStandardMaterial({ color: 0x2563eb }),
  head: new THREE.MeshStandardMaterial({ color: 0xe7c9a9 }),
  line: new THREE.LineBasicMaterial({ color: 0x12321f })
};

class EllipseArc extends THREE.Curve {
  constructor(a, b, He) { super(); this.a = a; this.b = b; this.He = He; }
  getPoint(t, target = new V3()) {
    const th = Math.PI * (1 - t);
    return target.set(this.a * Math.cos(th), this.He + this.b * Math.sin(th), 0);
  }
}

function archPath(g) {
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(new V3(-g.a, -0.05, 0), new V3(-g.a, g.He, 0)));
  path.add(new EllipseArc(g.a, g.b, g.He));
  path.add(new THREE.LineCurve3(new V3(g.a, g.He, 0), new V3(g.a, -0.05, 0)));
  return path;
}

// 被覆材の断面(左下→頂部→右下)。換気側は開口高さから始める。
function coverProfile(g, leftFrom, rightFrom, segs = 40, inset = 0) {
  const a = g.a - inset, b = Math.max(g.b - inset, 0.1);
  const pts = [new THREE.Vector2(-a, leftFrom)];
  if (leftFrom < g.He) pts.push(new THREE.Vector2(-a, g.He));
  for (let i = 0; i <= segs; i++) {
    const th = Math.PI * (1 - i / segs);
    pts.push(new THREE.Vector2(a * Math.cos(th), g.He + b * Math.sin(th)));
  }
  if (rightFrom < g.He) pts.push(new THREE.Vector2(a, g.He));
  pts.push(new THREE.Vector2(a, rightFrom));
  return pts;
}

function stripGeometry(pts, z0, z1) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    pos.set([pts[i].x, pts[i].y, z0], i * 6);
    pos.set([pts[i].x, pts[i].y, z1], i * 6 + 3);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function endWallShape(g, door) {
  const s = new THREE.Shape();
  s.moveTo(-g.a, 0); s.lineTo(-g.a, g.He);
  for (let i = 0; i <= 40; i++) { const th = Math.PI * (1 - i / 40); s.lineTo(g.a * Math.cos(th), g.He + g.b * Math.sin(th)); }
  s.lineTo(g.a, 0); s.closePath();
  if (door) {
    const h = new THREE.Path();
    h.moveTo(-door.w / 2, 0); h.lineTo(door.w / 2, 0); h.lineTo(door.w / 2, door.h); h.lineTo(-door.w / 2, door.h); h.closePath();
    s.holes.push(h);
  }
  return s;
}

function cylinderAlongZ(r, len, mat, x, y, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z);
  return m;
}
function cylinderAlongX(r, len, mat, x, y, z, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.z = Math.PI / 2; m.position.set(x, y, z);
  return m;
}
function post(r, h, mat, x, z, y0 = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), mat);
  m.position.set(x, y0 + h / 2, z);
  return m;
}
function label(text, x, y, z, cls = "dim-label") {
  const div = document.createElement("div");
  div.className = cls; div.textContent = text;
  const o = new CSS2DObject(div); o.position.set(x, y, z);
  return o;
}
function line(points) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new V3(...p)));
  return new THREE.Line(geo, MAT.line);
}

export function createViewer(container, options = {}) {
  const showcase = !!options.showcase;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!options.transparent, powerPreference: "high-performance" });
  } catch (e) {
    container.innerHTML = `<div class="viewer-fallback">この端末では3D表示(WebGL)を利用できません。<br>数量と概算見積りは右側の一覧でご確認ください。</div>`;
    return { update() {}, setView() {}, setLabels() {}, screenshot() { return null; }, dispose() {}, ok: false };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio || 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.exposure ?? 1.05;
  renderer.domElement.className = "viewer-canvas";
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "viewer-labels";
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(options.sky || 0xe4f0f7);
  scene.background = options.transparent ? null : skyColor;
  scene.fog = new THREE.FogExp2(skyColor.getHex(), options.fog ?? 0.0045);
  if (options.transparent) renderer.setClearColor(0x000000, 0);

  const camera = new THREE.PerspectiveCamera(options.fov || 42, 1, 0.1, 2000);
  camera.position.set(14, 7, -20);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  if (showcase) { controls.autoRotate = !!options.autoRotate; controls.autoRotateSpeed = options.rotateSpeed || 0.6; controls.enableZoom = !!options.zoom; controls.enablePan = false; controls.enabled = options.interactive !== false; }
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 1.2; controls.maxDistance = 600;
  controls.target.set(0, 1.5, 0);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b7a5b, 0.95));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  let house = null;       // 現在のハウス(Group)
  let labels = null;      // 寸法ラベル(Group)
  let heightLabels = null;// 高さのラベル(上から見るときは隠す)
  let currentView = "exterior";
  let labelsOn = !showcase;
  let g = null;           // 直近の形状
  let anim = null;        // カメラ移動
  let running = true;

  function disposeGroup(grp) {
    grp.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    });
    scene.remove(grp);
  }

  function build(est) {
    const p = est.params; g = est.geometry; const film = est.film;
    if (house) disposeGroup(house);
    if (labels) disposeGroup(labels);
    house = new THREE.Group(); labels = new THREE.Group();
    const { a, He, Hr, L, W } = g;
    const z0 = -L / 2, z1 = L / 2;
    const rPipe = Math.max((p.pipe / 1000) / 2 * 1.6, 0.018);
    const filmMat = new THREE.MeshStandardMaterial({ color: film.tint, transparent: true, opacity: film.opacity, side: THREE.DoubleSide, roughness: 0.12, metalness: 0, depthWrite: false });
    const doorFilm = filmMat.clone(); doorFilm.opacity = Math.min(film.opacity + 0.2, 0.85);

    // 地面・床土・畝
    const gsize = Math.max(L, W) * 2.4 + 40;
    if (showcase) {
      // 見せるモード: 地面は影だけを受ける透明面にして、背景の風景を透かす
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), new THREE.ShadowMaterial({ opacity: 0.28 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; house.add(ground);
      const patch = new THREE.Mesh(new THREE.CircleGeometry(Math.max(L, W) * 0.62, 48), new THREE.MeshStandardMaterial({ color: 0x7f9a5e, transparent: true, opacity: 0.55, roughness: 1 }));
      patch.rotation.x = -Math.PI / 2; patch.position.y = 0.003; patch.receiveShadow = true; house.add(patch);
    } else {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), MAT.grass);
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; house.add(ground);
      const grid = new THREE.GridHelper(gsize, Math.round(gsize / 2), 0x9fbf86, 0x9fbf86);
      grid.material.opacity = 0.35; grid.material.transparent = true; grid.position.y = 0.002; house.add(grid);
    }
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, L + 0.6), MAT.soil);
    soil.rotation.x = -Math.PI / 2; soil.position.y = 0.006; soil.receiveShadow = true; house.add(soil);
    const rows = g.dripRows;
    const rowGeo = new THREE.BoxGeometry(0.6, 0.16, Math.max(L - 1.2, 1));
    for (let i = 0; i < rows; i++) {
      const x = -a + 0.5 + (i + 0.5) * ((W - 1.0) / rows);
      const r = new THREE.Mesh(rowGeo, MAT.ridgeSoil); r.position.set(x, 0.08, 0); r.receiveShadow = true; house.add(r);
      if (p.irrigation === "drip") { const dr = cylinderAlongZ(0.012, Math.max(L - 1.2, 1), MAT.hose, x, 0.18, 0, 6); dr.userData.part = "irrigation"; house.add(dr); }
    }

    // アーチ(インスタンス化)
    const tube = new THREE.TubeGeometry(archPath(g), 64, rPipe, 8, false);
    const arches = new THREE.InstancedMesh(tube, MAT.steel, g.archCount);
    const pitchActual = g.archCount > 1 ? L / (g.archCount - 1) : 0;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < g.archCount; i++) { m4.makeTranslation(0, 0, z0 + i * pitchActual); arches.setMatrixAt(i, m4); }
    arches.instanceMatrix.needsUpdate = true; arches.castShadow = true; arches.userData.part = "arch"; house.add(arches);

    // 母屋(直管)
    for (let i = 0; i < g.purlinRuns; i++) {
      const th = THREE.MathUtils.degToRad(10 + i * (160 / (g.purlinRuns - 1)));
      const pl = cylinderAlongZ(rPipe * 0.9, L + 0.2, MAT.steel, a * Math.cos(th) * 0.985, He + g.b * Math.sin(th) * 0.985);
      pl.castShadow = true; pl.userData.part = "purlin"; house.add(pl);
      // アーチと母屋の交点(クロス金具の位置)
      if (!showcase || options.parts) { const jGeo = new THREE.SphereGeometry(rPipe * 1.9, 8, 8); const jm = new THREE.InstancedMesh(jGeo, MAT.dark, g.archCount); const mm = new THREE.Matrix4(); for (let k = 0; k < g.archCount; k++) { mm.makeTranslation(a * Math.cos(th) * 0.985, He + g.b * Math.sin(th) * 0.985, z0 + k * pitchActual); jm.setMatrixAt(k, mm); } jm.instanceMatrix.needsUpdate = true; jm.userData.part = "joint"; jm.visible = false; house.add(jm); }
    }

    // 脚元のアンカー(らせん杭)。ハイライト時だけ見せる
    if (!showcase || options.parts) { const ag = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6); const am = new THREE.InstancedMesh(ag, MAT.dark, g.archCount * 2); const mm = new THREE.Matrix4(); for (let k = 0; k < g.archCount; k++) { mm.makeTranslation(-a, 0.25, z0 + k * pitchActual); am.setMatrixAt(k * 2, mm); mm.makeTranslation(a, 0.25, z0 + k * pitchActual); am.setMatrixAt(k * 2 + 1, mm); } am.instanceMatrix.needsUpdate = true; am.userData.part = "anchor"; am.visible = false; house.add(am); }

    // 妻面骨組・ドア・妻面被覆
    const doorW = Math.min(1.8, W - 0.8);
    const doorH = Math.max(1.6, Math.min(1.9, He + 0.866 * g.b - 0.15));
    const ends = [{ z: z0, door: p.doors >= 1 }, { z: z1, door: p.doors >= 2 }];
    for (const e of ends) {
      const dz = e.z < 0 ? -0.02 : 0.02;
      const yAt = x => He + g.b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2));
      const xs = e.door ? [-doorW / 2, doorW / 2] : [-a / 2, a / 2];
      for (const x of xs) { const pp = post(rPipe * 0.9, yAt(x) - 0.02, MAT.steel, x, e.z); pp.castShadow = true; pp.userData.part = "endframe"; house.add(pp); }
      if (a > 1.5) for (const x of [-a * 0.72, a * 0.72]) house.add(post(rPipe * 0.9, yAt(x) - 0.02, MAT.steel, x, e.z));
      house.add(cylinderAlongX(rPipe * 0.9, W, MAT.steel, 0, e.door ? doorH + 0.05 : He * 0.6, e.z));
      const door = e.door ? { w: doorW, h: doorH } : null;
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(endWallShape(g, door)), filmMat);
      wall.position.z = e.z + dz; wall.userData.part = "film"; house.add(wall);
      if (door) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(doorW - 0.08, doorH - 0.06), doorFilm);
        panel.position.set(0, doorH / 2, e.z + dz * 3); panel.userData.part = "door"; house.add(panel);
        const fr = 0.035;
        const frame = [
          [-doorW / 2 + fr, doorH / 2, fr, doorH], [doorW / 2 - fr, doorH / 2, fr, doorH], [0, doorH - fr, doorW, fr], [0, fr, doorW, fr]
        ];
        for (const [x, y, w, h] of frame) { const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), MAT.dark); f.position.set(x, y, e.z + dz * 3); f.userData.part = "door"; house.add(f); }
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.06), MAT.dark); handle.position.set(doorW / 2 - 0.25, 1.0, e.z + dz * 4); house.add(handle);
      }
    }

    // 屋根・側面の被覆(換気開口を反映)
    const ventL = p.sideVent === "both" || p.sideVent === "one";
    const ventR = p.sideVent === "both";
    const vh = g.ventOpenHeight;
    const cover = new THREE.Mesh(stripGeometry(coverProfile(g, ventL ? vh : -0.02, ventR ? vh : -0.02), z0 - 0.04, z1 + 0.04), filmMat);
    cover.renderOrder = 2; cover.userData.part = "film"; house.add(cover);
    // 被覆材の固定レール(裾)とパッカー位置(肩)
    for (const side of [-1, 1]) { const rail = cylinderAlongZ(0.02, L + 0.1, MAT.dark, side * (a + 0.02), 0.06); rail.userData.part = "fastener"; house.add(rail); const sh = cylinderAlongZ(0.018, L + 0.1, MAT.dark, side * (a + 0.02), He); sh.userData.part = "fastener"; house.add(sh); }
    for (const [side, on] of [[-1, ventL], [1, ventR]]) {
      if (!on) continue;
      const x = side * (a + 0.09);
      const roll = cylinderAlongZ(0.075, L + 0.08, doorFilm, x, vh, 0, 14); roll.renderOrder = 3; roll.userData.part = "vent"; house.add(roll);
      const rp = cylinderAlongZ(rPipe, L + 0.3, MAT.steel, x, vh, 0); rp.userData.part = "vent"; house.add(rp);
      const crank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), MAT.dark); crank.position.set(x, vh - 0.15, z0 - 0.25); crank.userData.part = "vent"; house.add(crank);
      if (p.insectNet) {
        const net = new THREE.Mesh(new THREE.PlaneGeometry(L, vh - 0.05), MAT.net);
        net.rotation.y = Math.PI / 2; net.position.set(side * (a + 0.01), (vh - 0.05) / 2 + 0.03, 0); net.userData.part = "net"; house.add(net);
      }
    }

    // 天窓
    if (p.roofVent) {
      const flap = new THREE.Group(); flap.position.set(0, Hr + 0.02, 0); flap.rotation.z = 0.55;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, Math.max(L - 1, 1)), doorFilm);
      pl.rotation.x = -Math.PI / 2; pl.position.x = 0.4; flap.add(pl);
      flap.add(cylinderAlongZ(rPipe * 0.8, Math.max(L - 1, 1), MAT.steel, 0.8, 0));
      flap.traverse(o => { o.userData.part = "roofvent"; }); house.add(flap);
    }

    // 内張カーテン
    if (p.curtain !== "none") {
      const cur = new THREE.Mesh(stripGeometry(coverProfile(g, He * 0.55, He * 0.55, 32, 0.25), z0 + 0.3, z1 - 0.3), MAT.curtain);
      cur.renderOrder = 1; cur.userData.part = "curtain"; house.add(cur);
    }

    // 潅水(ミスト)
    if (p.irrigation === "mist") {
      const mp = cylinderAlongZ(0.02, L - 0.5, MAT.hose, 0, Hr - 0.4); mp.userData.part = "irrigation"; house.add(mp);
      const nozGeo = new THREE.SphereGeometry(0.05, 8, 8);
      for (let z = z0 + 1; z < z1 - 0.5; z += 3) { const n = new THREE.Mesh(nozGeo, MAT.nozzle); n.position.set(0, Hr - 0.45, z); n.userData.part = "irrigation"; house.add(n); }
    }

    // 耐雪補強
    if (p.snow) {
      for (let i = 0; i < g.snowPosts; i++) {
        const z = z0 + 0.4 + i * ((L - 0.8) / Math.max(g.snowPosts - 1, 1));
        const pp = post(rPipe, Hr - 0.03, MAT.steel, 0, z); pp.castShadow = true; pp.userData.part = "reinforce"; house.add(pp);
      }
      const ty = He + g.b * 0.45, tx = a * Math.sqrt(1 - 0.45 ** 2) * 2;
      for (let i = 0; i < g.snowTies; i++) {
        const z = z0 + i * (L / Math.max(g.snowTies - 1, 1));
        const tb = cylinderAlongX(rPipe * 0.9, tx, MAT.steel, 0, ty, Math.min(z, z1)); tb.userData.part = "reinforce"; house.add(tb);
      }
    }

    // スケール用の人物(身長約1.7m)
    const person = new THREE.Group(); person.position.set(a + 1.2, 0, z0 - 0.8); person.visible = !showcase;
    person.add(post(0.13, 0.8, MAT.legs, 0, 0), post(0.19, 0.62, MAT.torso, 0, 0, 0.8));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), MAT.head); head.position.y = 1.57; person.add(head);
    person.traverse(o => { if (o.isMesh) o.castShadow = true; });
    house.add(person);

    // 寸法線とラベル
    const dz = z0 - 1.3, dx = a + 1.8, lx = -a - 0.6;
    labels.add(line([[-a, 0.05, dz], [a, 0.05, dz]]), line([[-a, 0.05, dz - 0.15], [-a, 0.05, dz + 0.15]]), line([[a, 0.05, dz - 0.15], [a, 0.05, dz + 0.15]]));
    labels.add(line([[dx, 0.05, z0], [dx, 0.05, z1]]), line([[dx - 0.15, 0.05, z0], [dx + 0.15, 0.05, z0]]), line([[dx - 0.15, 0.05, z1], [dx + 0.15, 0.05, z1]]));
    labels.add(line([[lx, 0, z0], [lx, Hr, z0]]), line([[lx - 0.15, Hr, z0], [lx + 0.15, Hr, z0]]), line([[lx - 0.15, He, z0], [lx + 0.15, He, z0]]));
    labels.add(label(`間口 ${W}m`, 0, 0.1, dz - 0.4));
    labels.add(label(`奥行 ${L}m`, dx + 0.6, 0.1, 0));
    heightLabels = new THREE.Group();
    heightLabels.add(label(`棟高 ${Hr}m`, lx - 0.3, Hr + 0.15, z0));
    heightLabels.add(label(`肩高 ${He}m`, lx - 0.3, He - 0.1, z0));
    heightLabels.visible = currentView !== "top";
    labels.add(heightLabels);
    labels.add(label(`床面積 ${g.floorArea.toFixed(1)}m²`, 0, Hr + 0.6, 0, "dim-label strong"));
    labels.visible = labelsOn;

    scene.add(house, labels);

    // 影の範囲と太陽の位置
    const span = Math.max(L, W) * 0.75 + 6;
    sun.position.set(W * 1.2 + 8, Math.max(Hr * 4, 14), -L * 0.35 - 6);
    sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 400; sc.updateProjectionMatrix();
  }

  function computePose(view = "exterior") {
    if (!g) return null;
    const { a, Hr, L } = g;
    const c = new V3(0, Hr * 0.45, 0);
    const R = Math.sqrt(a * a + (Hr / 2) ** 2 + (L / 2) ** 2);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const f = Math.min(vfov, hfov);
    let dist = R / Math.sin(f / 2);
    let pos = null, target = c.clone(), dir;
    switch (view) {
      case "front": dir = new V3(0.22, 0.3, -1); dist *= 0.8; target.set(0, Hr * 0.4, 0); break;
      case "side": dir = new V3(1, 0.42, 0.06); break;
      case "top": dir = new V3(0, 1, -0.001); dist *= 0.95; break;
      case "interior": pos = new V3(-a * 0.3, 1.75, -L / 2 + 1.2); pos.isInterior = true; target = new V3(-a * 0.12, 1.2, L / 2); break; // 中柱と正面衝突しないよう少し横にずらす
      case "eave": pos = new V3(a + 2.2, 1.6, -L / 2 + 3.5); pos.isInterior = true; target = new V3(0, g.He + 0.6, L * 0.15); break; // 軒下から奥を見る
      default: dir = showcase ? (camera.aspect < 1 ? new V3(0.7, 0.42, -1.0) : new V3(1, 0.4, -1.1)) : camera.aspect < 1 ? new V3(0.55, 0.6, -1.15) : new V3(1, 0.62, -1.25); // 縦長画面では奥行方向から見て収まりを良くする
    }
    if (!pos) {
      dir.normalize();
      // 外接球ベースの距離から始め、8つの角が画面に収まる最短距離に詰める
      const corners = [];
      for (const x of [-a - 0.9, a + 1.6]) for (const y of [0, Hr + 0.6]) for (const z of [-L / 2 - 1.2, L / 2 + 0.3]) corners.push(new V3(x, y, z));
      const tmpCam = camera.clone();
      const right = new V3(), up = new V3();
      const tanV = Math.tan(vfov / 2), tanH = tanV * camera.aspect;
      for (let i = 0; i < 5; i++) {
        tmpCam.position.copy(target).add(dir.clone().multiplyScalar(dist));
        tmpCam.lookAt(target); tmpCam.updateMatrixWorld(); tmpCam.updateProjectionMatrix();
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (const k of corners) { const v = k.clone().project(tmpCam); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
        // 画面上の中心がずれている分だけ注視点をずらし、8つの角が収まる距離に詰める
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        right.setFromMatrixColumn(tmpCam.matrixWorld, 0); up.setFromMatrixColumn(tmpCam.matrixWorld, 1);
        target.add(right.multiplyScalar(cx * dist * tanH)).add(up.multiplyScalar(cy * dist * tanV));
        dist *= Math.max(Math.max(maxX - minX, maxY - minY) / 2, 0.05) * 1.04;
      }
      pos = target.clone().add(dir.multiplyScalar(dist));
    }
    if (showcase && !pos.isInterior) { const k = options.zoomFactor || 0.86; pos.copy(target.clone().add(pos.clone().sub(target).multiplyScalar(k))); }
    pos.y = Math.max(pos.y, 0.5);
    return { pos, target };
  }
  // ---- サンプルの3Dモデル(Blender などから書き出した .glb を読む)。複数持てる ----
  const samples = [];   // { group, root, label }
  let sampleIdx = -1;   // -1 = 寸法から組み立てたハウスを表示

  function poseForBox(box, view) {
    const c = box.getCenter(new V3()), sz = box.getSize(new V3());
    const a = sz.x / 2, L = sz.z;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    let target = new V3(c.x, box.min.y + sz.y * 0.45, c.z), dir = null, pos = null;
    let dist = box.getBoundingSphere(new THREE.Sphere()).radius / Math.sin(vfov / 2) * 1.15;
    switch (view) {
      case "front": dir = new V3(0, 0.2, -1); break;
      case "side": dir = new V3(1, 0.2, -0.02); break;
      case "top": dir = new V3(0.001, 1, -0.001); break;
      case "interior": pos = new V3(c.x, box.min.y + Math.min(1.6, sz.y * 0.42), c.z + L * 0.42); pos.isInterior = true; target = new V3(c.x, box.min.y + sz.y * 0.45, c.z - L * 0.35); break;
      case "eave": pos = new V3(c.x + a + 2.2, box.min.y + 1.6, c.z - L * 0.35); pos.isInterior = true; target = new V3(c.x, box.min.y + sz.y * 0.55, c.z + L * 0.15); break;
      default: dir = camera.aspect < 1 ? new V3(0.7, 0.42, -1.0) : new V3(1, 0.45, -1.2);
    }
    if (!pos) {
      dir.normalize();
      const corners = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new V3(x, y, z));
      const tmpCam = camera.clone(), right = new V3(), up = new V3();
      const tanV = Math.tan(vfov / 2), tanH = tanV * camera.aspect;
      for (let i = 0; i < 6; i++) {
        tmpCam.position.copy(target).add(dir.clone().multiplyScalar(dist));
        tmpCam.lookAt(target); tmpCam.updateMatrixWorld(); tmpCam.updateProjectionMatrix();
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (const k of corners) { const v = k.clone().project(tmpCam); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        right.setFromMatrixColumn(tmpCam.matrixWorld, 0); up.setFromMatrixColumn(tmpCam.matrixWorld, 1);
        target.add(right.multiplyScalar(cx * dist * tanH)).add(up.multiplyScalar(cy * dist * tanV));
        dist *= Math.max(Math.max(maxX - minX, maxY - minY) / 2, 0.05) * 1.12;   // 端に触れないよう少し余裕をとる
      }
      pos = target.clone().add(dir.multiplyScalar(dist));
    }
    if (showcase && !pos.isInterior) { const k = options.zoomFactor || 0.86; pos.copy(target.clone().add(pos.clone().sub(target).multiplyScalar(k))); }
    pos.y = Math.max(pos.y, box.min.y + 0.5);
    return { pos, target };
  }

  // url の .glb を読み込んでサンプルに加える。読めなければ false を返して今までどおりの表示を続ける。
  async function loadModel(url, opt = {}) {
    let GLTFLoader;
    try { ({ GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js")); }
    catch (e) { console.warn("GLTFLoader を読み込めませんでした", e); return false; }
    let gltf;
    try { gltf = await new GLTFLoader().loadAsync(url); }
    catch (e) { console.warn("3Dモデルを読み込めませんでした:", url, e.message || e); return false; }

    const root = gltf.scene;
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.map) m.map.anisotropy = 4;
    });

    // 大きさと位置をそろえる: 底面を地面(y=0)に、平面の中心を原点に
    let box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new V3());
    if (opt.width && size.x > 0.001) root.scale.setScalar(opt.width / size.x);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new V3());
    root.position.sub(new V3(c.x, box.min.y, c.z));
    root.updateMatrixWorld(true);

    const group = new THREE.Group();
    group.add(root);
    // 地面(影の受け皿)。透過表示のときは影だけ落とす
    box = new THREE.Box3().setFromObject(root);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4),
      options.transparent ? new THREE.ShadowMaterial({ opacity: 0.28 }) : MAT.grass);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
    group.visible = false;
    scene.add(group);

    samples.push({ group, root, label: opt.label || `サンプル${samples.length + 1}` });
    const idx = samples.length - 1;
    if (opt.show !== false) setSample(idx);
    return idx;
  }

  // true/0以上 = そのサンプルを表示、false/-1 = 寸法から組み立てたハウスに戻す
  function setSample(v) {
    const want = v === true ? 0 : (v === false || v == null) ? -1 : Number(v);
    sampleIdx = (want >= 0 && samples[want]) ? want : -1;
    samples.forEach((s2, i) => { s2.group.visible = i === sampleIdx; });
    if (house) house.visible = sampleIdx < 0;
    if (labels) labels.visible = sampleIdx < 0 && labelsOn;
    if (sampleIdx >= 0) {
      // 太陽の影の範囲をモデルに合わせる
      const box = new THREE.Box3().setFromObject(samples[sampleIdx].root);
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y) * 1.2;
      const sc = sun.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = r * 8; sc.updateProjectionMatrix();
    }
    fit(currentView, false);
    return sampleIdx;
  }

  function fit(view = "exterior", animate = true) {
    const pose = sampleIdx >= 0 ? poseForBox(new THREE.Box3().setFromObject(samples[sampleIdx].root), view) : computePose(view);
    if (!pose) return;
    currentView = view;
    if (heightLabels) heightLabels.visible = view !== "top";
    if (!animate) { camera.position.copy(pose.pos); controls.target.copy(pose.target); controls.update(); anim = null; return; }
    anim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pose.pos, t1: pose.target, start: performance.now(), dur: options.cameraMs || 650 };
  }

  function resize() {
    const w = container.clientWidth || 640, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (anim) {
      const t = Math.min(1, (now - anim.start) / anim.dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      camera.position.lerpVectors(anim.p0, anim.p1, e);
      controls.target.lerpVectors(anim.t0, anim.t1, e);
      if (t >= 1) anim = null;
    }
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => { if (document.hidden) running = false; else if (!running) { running = true; requestAnimationFrame(frame); } });

  let first = true;
  return {
    ok: true,
    setLight({ color, intensity, azimuth, elevation } = {}) {
      if (color != null) sun.color.set(color);
      if (intensity != null) sun.intensity = intensity;
      if (azimuth != null && elevation != null && g) { const r = Math.max(g.L, g.W) * 1.2 + 10; sun.position.set(Math.cos(elevation) * Math.cos(azimuth) * r, Math.sin(elevation) * r, Math.cos(elevation) * Math.sin(azimuth) * r); }
    },
    setSky(hex) { const c = new THREE.Color(hex); if (!options.transparent) scene.background = c; scene.fog.color = c; },
    setAutoRotate(on) { controls.autoRotate = !!on; },
    getPose(view) { return computePose(view); },
    // 部位を光らせる: arch / purlin / joint / endframe / film / fastener / door / vent / net / roofvent / curtain / irrigation / reinforce / anchor。null で解除
    highlight(part) {
      if (!house) return;
      const glow = new THREE.Color(0xE8622A);
      house.traverse(o => {
        if (!o.isMesh) return;
        const mine = o.userData.part && (o.userData.part === part);
        if (o.userData.part === "joint" || o.userData.part === "anchor") o.visible = mine; // 普段は隠している部位
        if (!o.userData.part) return;
        if (!o.userData.origMat) o.userData.origMat = o.material;
        if (mine) {
          if (!o.userData.glowMat) { const m = o.userData.origMat.clone(); m.emissive = glow; m.emissiveIntensity = 0.9; m.color = new THREE.Color(0xff9a5c); m.transparent = false; m.opacity = 1; m.depthWrite = true; o.userData.glowMat = m; }
          o.material = o.userData.glowMat;
        } else {
          o.material = o.userData.origMat;
          if (part && o.userData.dimMat === undefined) { const m = o.userData.origMat.clone(); if (m.transparent) m.opacity = Math.min(m.opacity, 0.18); else { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; } o.userData.dimMat = m; }
          if (part && o.userData.dimMat) o.material = o.userData.dimMat;
        }
      });
    },
    setPose(pos, target) { anim = null; camera.position.copy(pos); controls.target.copy(target); controls.update(); },
    get camera() { return camera; },
    update(est, opts = {}) {
      const prev = g ? { L: g.L, W: g.W, Hr: g.Hr } : null;
      build(est);
      const changed = !prev || Math.abs(prev.L - g.L) > 0.01 || Math.abs(prev.W - g.W) > 0.01 || Math.abs(prev.Hr - g.Hr) > 0.01;
      if (first) { fit("exterior", false); first = false; }
      else if (changed && opts.refit !== false) fit(opts.view || "exterior", true);
    },
    setView(name) { fit(name, true); },
    // Blender などから書き出した .glb をサンプルとして読み込む(何棟でも)
    loadModel(url, opt) { return loadModel(url, opt); },
    setSample(v) { return setSample(v); },
    get samples() { return samples.map((s2, i) => ({ index: i, label: s2.label })); },
    get sampleIndex() { return sampleIdx; },
    setLabels(on) { labelsOn = !!on; if (labels) labels.visible = labelsOn; },
    screenshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
    dispose() { running = false; ro.disconnect(); controls.dispose(); if (house) disposeGroup(house); for (const s2 of samples) disposeGroup(s2.group); if (labels) disposeGroup(labels); renderer.dispose(); }
  };
}
