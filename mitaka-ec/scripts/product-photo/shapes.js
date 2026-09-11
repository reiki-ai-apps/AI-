// 商品ごとの立体を、実際の寸法から組み立てる。
// 写真が用意できるまでの「スタジオ撮影風レンダリング」に使う。実物写真が入ったら不要になる。
import * as THREE from "three";

// 亜鉛メッキ特有のまだら(スパングル)を手続きで作る。写真らしさの要。
let _noise = null;
function noiseTex(scale = 1) {
  if (_noise) return _noise;
  const S = 512;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, S, S);
  const rnd = (n, alpha) => {
    const t = document.createElement("canvas"); t.width = t.height = n;
    const tc = t.getContext("2d"); const img = tc.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = 60 + Math.random() * 135; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    tc.putImageData(img, 0, 0);
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.drawImage(t, 0, 0, S, S); ctx.globalAlpha = 1;
  };
  rnd(22, 0.75); rnd(64, 0.35); rnd(180, 0.22);
  _noise = new THREE.CanvasTexture(c);
  _noise.wrapS = _noise.wrapT = THREE.RepeatWrapping;
  _noise.repeat.set(3, 3);
  return _noise;
}
const metalMat = (color, metalness, roughness, rep = 3) => {
  const t = noiseTex(); const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, roughnessMap: t, envMapIntensity: 1.15 });
  return m;
};

const M = {
  steel: () => metalMat(0xc2c8cc, 0.92, 0.30),
  steelDark: () => metalMat(0x949b9f, 0.9, 0.40),
  alu: () => metalMat(0xd2d7da, 0.92, 0.24),
  zinc: () => metalMat(0xb3babf, 0.86, 0.42),
  black: () => new THREE.MeshStandardMaterial({ color: 0x26292c, metalness: 0.08, roughness: 0.48 }),
  darkGrey: () => new THREE.MeshStandardMaterial({ color: 0x3c4247, metalness: 0.2, roughness: 0.5 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xeceae4, metalness: 0.03, roughness: 0.42 }),
  cream: () => new THREE.MeshStandardMaterial({ color: 0xdfd9cc, metalness: 0.02, roughness: 0.55 }),
  orange: () => new THREE.MeshStandardMaterial({ color: 0xE8622A, metalness: 0.05, roughness: 0.4 }),
  green: () => new THREE.MeshStandardMaterial({ color: 0x2f6b45, metalness: 0.05, roughness: 0.5 }),
  film: (tint = 0xdfe9f2, opacity = 0.5) => new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.12, transmission: 0.82, thickness: 0.4, ior: 1.46, transparent: true, opacity: 1, side: THREE.DoubleSide, clearcoat: 0.4 }),
  filmRoll: (tint = 0xe8eef4) => new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.2, transmission: 0.55, thickness: 1.2, ior: 1.46, side: THREE.DoubleSide, clearcoat: 0.5 }),
  mesh: (color = 0x1d2124) => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x1a1c1e, metalness: 0.02, roughness: 0.75 }),
  screen: () => new THREE.MeshStandardMaterial({ color: 0x10202a, metalness: 0.3, roughness: 0.15, emissive: 0x123040, emissiveIntensity: 0.5 })
};


// 網目のテクスチャ。目合い(mm)と糸径から実寸どおりに作る。
const _net = {};
function netTex(mm = 16, thread = 1.0, color = "#1f2529") {
  const k = `${mm}/${thread}/${color}`;
  if (_net[k]) return _net[k];
  const HOLES = 22, S = 512, cell = S / HOLES;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d");
  x.clearRect(0, 0, S, S);
  x.strokeStyle = color; x.lineCap = "butt";
  x.lineWidth = Math.max(2.6, cell * (thread / mm));
  for (let i = 0; i <= HOLES; i++) {
    const v = i * cell;
    x.beginPath(); x.moveTo(v, 0); x.lineTo(v, S); x.stroke();
    x.beginPath(); x.moveTo(0, v); x.lineTo(S, v); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 8;
  t.userData.tile = HOLES * mm / 1000;   // テクスチャ1枚が覆う実寸(m)
  _net[k] = t; return t;
}
// アルミ蒸着スクリーンの縞
const _stripe = {};
function stripeTex(pitchMm = 30, metalRatio = 0.5) {
  const k = `${pitchMm}/${metalRatio}`;
  if (_stripe[k]) return _stripe[k];
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d");
  x.fillStyle = "#f2f1ec"; x.fillRect(0, 0, S, S);
  const n = 8, cell = S / n;
  for (let i = 0; i < n; i++) {
    const g = x.createLinearGradient(0, i * cell, 0, i * cell + cell * metalRatio);
    g.addColorStop(0, "#9aa2a8"); g.addColorStop(0.45, "#e8ebee"); g.addColorStop(1, "#8f979d");
    x.fillStyle = g; x.fillRect(0, i * cell, S, cell * metalRatio);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.userData.tile = n * pitchMm / 1000;
  _stripe[k] = t; return t;
}

const tube = (r, len, mat, seg = 48) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg, 1, false), mat); m.castShadow = m.receiveShadow = true; return m; };
const pipeHollow = (r, len, mat, wall = 0.0012) => {
  const g = new THREE.Group();
  const outer = tube(r, len, mat); g.add(outer);
  const cap = new THREE.Mesh(new THREE.RingGeometry(r - wall, r, 48), mat.clone());
  cap.rotation.x = -Math.PI / 2; cap.position.y = len / 2 + 0.0002; g.add(cap);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(r - wall, r - wall, 0.02, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a4045, metalness: 0.6, roughness: 0.7, side: THREE.BackSide }));
  bore.position.y = len / 2 - 0.01; g.add(bore);
  return g;
};
const box = (w, h, d, mat, r = 0) => { const m = new THREE.Mesh(r ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), mat); m.castShadow = m.receiveShadow = true; return m; };
function roundedBox(w, h, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: r * 0.3, bevelThickness: r * 0.3, bevelSegments: 3, curveSegments: 12 });
  g.center(); return g;
}
const bolt = (len = 0.03, r = 0.004) => {
  const g = new THREE.Group();
  const shaft = tube(r, len, M.steelDark(), 12); g.add(shaft);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(r * 2, r * 2, r * 1.6, 6), M.steelDark()); head.position.y = len / 2; head.castShadow = true; g.add(head);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(r * 2, r * 2, r * 1.4, 6), M.steelDark()); nut.position.y = -len / 2; nut.castShadow = true; g.add(nut);
  return g;
};
// 帯金具(クロスバンド)の半円
function bandHalf(r, width, mat) {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(r + 0.002, 0.0018, 8, 28, Math.PI), mat);
  arc.scale.z = width / 0.004; arc.castShadow = true;
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.002, r + 0.002, width, 32, 1, true, 0, Math.PI), mat);
  strip.rotation.z = Math.PI / 2; strip.rotation.y = Math.PI / 2; strip.castShadow = true; strip.receiveShadow = true;
  g.add(strip);
  for (const s of [-1, 1]) { const ear = box(0.012, 0.0025, width, mat); ear.position.set(s * (r + 0.008), 0, 0); g.add(ear); }
  return g;
}


// C字クランプ(帯金具)。軸は Z、帯が覆う向きは +X。厚みのある実物らしい断面。
function clampShell(r, wall, width, mat, arc = Math.PI * 1.2) {
  const sh = new THREE.Shape();
  const a0 = -arc / 2, a1 = arc / 2, n = 132;
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; const x = Math.cos(a) * (r + wall), y = Math.sin(a) * (r + wall); i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: wall * 0.22, bevelThickness: wall * 0.22, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -width / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  return m;
}
// axis: "z" | "x"、cover: 帯が覆う向き(ラジアン、+X から)
function clampOriented(r, wall, width, mat, arc, axis, cover) {
  const inner = new THREE.Group(); inner.add(clampShell(r, wall, width, mat, arc)); inner.rotation.z = cover;
  const outer = new THREE.Group(); outer.add(inner);
  if (axis === "x") outer.rotation.y = Math.PI / 2;
  return outer;
}
// くさび(クロス金具のキー)
function wedge(h, w, t, mat) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w * 0.34, h); sh.lineTo(-w * 0.34, h); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

// ---- 形ごとの組み立て。すべて実寸(メートル)で作る ----
export const BUILDERS = {
  pipe({ dia = 25.4, len = 5.5 }) { // 束(実物も束で届く)。全長は規格表記に任せ、手前を大きく写す
    const g = new THREE.Group(); const r = dia / 2000, shown = Math.min(len, 1.5);
    const rows = [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [-0.5, -1], [0.5, -1]];
    for (const [i, j] of rows) {
      const p = pipeHollow(r, shown, M.zinc()); p.rotation.z = Math.PI / 2;
      p.position.set(0, r + j * r * 1.74, i * r * 2.02);
      g.add(p);
    }
    for (const x of [-shown * 0.3, shown * 0.3]) { // 結束バンド
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 3.15, 0.0022, 8, 40), M.black());
      band.rotation.y = Math.PI / 2; band.position.set(x, r * 1.0, 0); band.scale.set(1, 1.08, 1); band.castShadow = true; g.add(band);
    }
    return { obj: g, size: shown };
  },
  arch({ dia = 25.4, span = 5.4, eave = 1.6, ridge = 3.0, n = 6 }) {
    const g = new THREE.Group(); const r = dia / 2000, a = span / 2, b = ridge - eave;
    const pts = []; for (let i = 0; i <= 60; i++) { const t = Math.PI * (1 - i / 60); pts.push(new THREE.Vector3(a * Math.cos(t), b * Math.sin(t), 0)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 110, r, 20, false);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, M.zinc());
      m.position.z = (i - (n - 1) / 2) * r * 2.06;
      m.castShadow = m.receiveShadow = true; g.add(m);
    }
    for (const x of [-a * 0.55, a * 0.55]) { // 結束バンド
      const y = b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2));
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * n * 1.06, 0.0026, 8, 40), M.black());
      band.rotation.y = Math.PI / 2; band.rotation.x = Math.PI / 2; band.position.set(x, y, 0); band.scale.set(1, 1, 0.34); band.castShadow = true; g.add(band);
    }
    g.rotation.y = -0.28;
    return { obj: g, size: span };
  },

  joint({ dia = 25.4 }) { // 天井ジョイント: 峰でアーチ2本をまたぐ金具(単体)
    const g = new THREE.Group(); const r = dia / 2000 + 0.0007, wall = 0.0022, w = 0.04;
    for (const sgn of [-1, 1]) {
      const c = clampOriented(r, wall, w, M.steelDark(), Math.PI * 1.18, "x", Math.PI / 2);
      c.position.set(sgn * (r * 1.65), 0, 0); c.rotation.z = sgn * -0.16; g.add(c);
    }
    const strap = box(r * 3.6, 0.0021, w * 0.34, M.steelDark(), 0.0015); strap.position.y = r + wall * 1.1; g.add(strap);
    const b = bolt(r * 1.3, 0.0022); b.position.set(0, r + wall * 1.1, 0); g.add(b);
    return { obj: g, size: r * 6.2 };
  },

  cross({ dia = 25.4 }) { // パイプクロス / パイプバンド: 直交する2本をはさむ金具(単体)
    const g = new THREE.Group(); const r = dia / 2000 + 0.0007, wall = 0.0026, w = 0.034;
    const up = clampOriented(r, wall, w, M.steelDark(), Math.PI * 1.32, "x", Math.PI / 2);
    up.position.y = r + wall; g.add(up);
    const dn = clampOriented(r, wall, w, M.steelDark(), Math.PI * 1.32, "z", -Math.PI / 2);
    dn.position.y = -(r + wall); g.add(dn);
    const link = box(w * 0.5, (r + wall) * 2.0, w * 0.5, M.steelDark(), 0.0015); g.add(link);
    const k = wedge(r * 1.5, r * 0.62, 0.0026, M.steel()); k.position.set(r * 0.92, -r * 0.25, w * 0.30); k.rotation.z = 0.14; g.add(k);
    return { obj: g, size: r * 6.4 };
  },
  tee({ dia = 25.4 }) { // リング式Tバンド(単体)
    const g = new THREE.Group(); const r = dia / 2000 + 0.0007, wall = 0.0024, w = 0.03;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + wall / 2, wall * 0.9, 12, 44), M.steelDark());
    ring.rotation.y = Math.PI / 2; ring.scale.set(1, 1, w / (wall * 1.8)); ring.castShadow = true; g.add(ring);
    const dn = clampOriented(r, wall, w, M.steelDark(), Math.PI * 1.15, "z", -Math.PI / 2);
    dn.position.y = -(r * 2 + wall); g.add(dn);
    const stem = box(w * 0.7, r * 2.1, w * 0.7, M.steelDark(), 0.002); stem.position.y = -r * 1.05; g.add(stem);
    const b = bolt(r * 1.9, 0.0032); b.position.set(0, -(r * 2.1 + wall), 0); b.rotation.x = Math.PI / 2; g.add(b);
    return { obj: g, size: r * 6.6 };
  },
  sleeve({ dia = 25.4 }) { // 内ジョイント: 直管の中に差し込む短い管(単体)
    const g = new THREE.Group(); const r = dia / 2000 - 0.0016;
    const body = pipeHollow(r, 0.14, M.zinc(), 0.0011); body.rotation.z = Math.PI / 2; g.add(body);
    const stop = new THREE.Mesh(new THREE.TorusGeometry(r * 1.06, 0.0022, 10, 36), M.zinc()); stop.rotation.y = Math.PI / 2; stop.castShadow = true; g.add(stop);
    for (const sgn of [-1, 1]) { const groove = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.0012, 8, 36), M.steelDark()); groove.rotation.y = Math.PI / 2; groove.position.x = sgn * 0.045; g.add(groove); }
    return { obj: g, size: 0.16 };
  },
  angle({ dia = 25.4, swivel = false }) { // 両スエジジョイント(曲げ管) / 自在バンド
    const g = new THREE.Group(); const r = dia / 2000;
    if (swivel) {
      const wall = 0.0024, w = 0.03;
      const a = clampOriented(r + 0.0007, wall, w, M.steelDark(), Math.PI * 1.3, "x", Math.PI / 2); a.position.y = r + wall; g.add(a);
      const b2 = clampOriented(r + 0.0007, wall, w, M.steelDark(), Math.PI * 1.3, "x", -Math.PI / 2); b2.position.y = -(r + wall); b2.rotation.y = 0.9; g.add(b2);
      const pivot = bolt(r * 4.4, 0.0036); g.add(pivot);
      return { obj: g, size: r * 7 };
    }
    // 120° に曲げたスエジ管(片側が細く絞ってある)
    const pts = [];
    const R = 0.09, halfArc = Math.PI / 3;
    for (let i = 0; i <= 40; i++) { const t = -halfArc + (2 * halfArc) * i / 40; pts.push(new THREE.Vector3(Math.sin(t) * R, Math.cos(t) * R, 0)); }
    pts.unshift(new THREE.Vector3(Math.sin(-halfArc) * R - 0.09, Math.cos(-halfArc) * R - 0.052, 0));
    pts.push(new THREE.Vector3(Math.sin(halfArc) * R + 0.09, Math.cos(halfArc) * R - 0.052, 0));
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, r, 24, false), M.zinc());
    m.castShadow = m.receiveShadow = true; g.add(m);
    const sw = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.05, 28), M.zinc());
    sw.position.copy(pts[pts.length - 1]); sw.rotation.z = Math.PI / 2 - 0.5; sw.castShadow = true; g.add(sw);
    return { obj: g, size: 0.3 };
  },
  packer({ dia = 25.4, steel = false }) { // パッカー(ナイスキャッチ) / フィルム止金具
    const g = new THREE.Group(); const r = dia / 2000 + 0.0013;
    const mat = steel ? M.steel() : new THREE.MeshStandardMaterial({ color: 0x1e2124, metalness: 0.04, roughness: 0.34, envMapIntensity: 1.0 });
    const wall = steel ? 0.0014 : 0.0034, w = steel ? 0.028 : 0.055, arc = Math.PI * 1.48;
    const c = clampShell(r, wall, w, mat, arc); c.rotation.z = Math.PI / 2; g.add(c);
    // 口の反り(差し込みやすいように外へ開く)
    for (const sgn of [-1, 1]) {
      const a = Math.PI / 2 + sgn * arc / 2;
      const lip = box(0.0072, wall * 0.9, w, mat);
      const tx = -Math.sin(a) * sgn, ty = Math.cos(a) * sgn;   // 接線方向
      lip.position.set(Math.cos(a) * (r + wall / 2) + tx * 0.0031, Math.sin(a) * (r + wall / 2) + ty * 0.0031, 0);
      lip.rotation.z = Math.atan2(ty, tx) + sgn * 0.34;
      g.add(lip);
    }
    return { obj: g, size: r * 4.6 };
  },

  rail({ len = 4 }) { // ビニペット + スプリング
    const g = new THREE.Group();
    const shown = Math.min(len, 0.6);
    const prof = new THREE.Shape();
    prof.moveTo(-0.013, 0); prof.lineTo(0.013, 0); prof.lineTo(0.013, 0.004); prof.lineTo(0.008, 0.004);
    prof.lineTo(0.008, 0.016); prof.lineTo(0.005, 0.019); prof.lineTo(-0.005, 0.019); prof.lineTo(-0.008, 0.016);
    prof.lineTo(-0.008, 0.004); prof.lineTo(-0.013, 0.004); prof.closePath();
    const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: shown, bevelEnabled: false }), M.alu());
    rail.rotation.y = Math.PI / 2; rail.position.x = -shown / 2; rail.castShadow = rail.receiveShadow = true; g.add(rail);
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 200 }, (_, i) => { const t = i / 199, x = -shown / 2 + t * shown, a = t * Math.PI * 2 * 22; return new THREE.Vector3(x, 0.011 + Math.cos(a) * 0.0055, Math.sin(a) * 0.0055); }));
    const spring = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.0016, 8, false), M.steel()); spring.castShadow = true; g.add(spring);
    return { obj: g, size: shown * 1.1 };
  },
  spring({ }) { // ヒフクスプリング(単体)
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 260 }, (_, i) => { const t = i / 259, x = -0.17 + t * 0.34, a = t * Math.PI * 2 * 26; return new THREE.Vector3(x, Math.cos(a) * 0.0105, Math.sin(a) * 0.0105); }));
    const s = new THREE.Mesh(new THREE.TubeGeometry(curve, 520, 0.0022, 10, false), M.steel()); s.castShadow = true; g.add(s);
    return { obj: g, size: 0.38 };
  },
  filmRoll({ width = 5.4, tint = 0xe8eef4, len = 100, diffuse = false, label = 0xE8622A }) {
    const g = new THREE.Group();
    const w = Math.min(width, 2.4), R = 0.17;
    const rollMat = diffuse
      ? new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.5, transmission: 0.22, thickness: 1.6, ior: 1.46, side: THREE.DoubleSide, clearcoat: 0.25 })
      : new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.13, transmission: 0.26, thickness: 2.0, ior: 1.46, side: THREE.DoubleSide, clearcoat: 0.75, clearcoatRoughness: 0.06 });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 72, 1, true), rollMat);
    roll.rotation.z = Math.PI / 2; roll.castShadow = roll.receiveShadow = true; g.add(roll);
    for (const sgn of [-1, 1]) { const face = new THREE.Mesh(new THREE.RingGeometry(0.042, R, 72), rollMat); face.rotation.y = sgn * Math.PI / 2; face.position.x = sgn * w / 2; g.add(face); }
    // 紙の芯
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, w + 0.05, 40), M.cream()); core.rotation.z = Math.PI / 2; core.castShadow = true; g.add(core);
    // 商品ラベル(巻きに貼ってある帯)
    const bw = Math.min(0.34, w * 0.32), bx = -w / 2 + bw / 2 + 0.05;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0018, R + 0.0018, bw, 72, 1, true), new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.62, side: THREE.DoubleSide }));
    band.rotation.z = Math.PI / 2; band.position.x = bx; band.castShadow = true; g.add(band);
    for (const off of [-bw / 2 + 0.035, bw / 2 - 0.035]) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0026, R + 0.0026, 0.05, 72, 1, true), new THREE.MeshStandardMaterial({ color: label, roughness: 0.48, side: THREE.DoubleSide }));
      stripe.rotation.z = Math.PI / 2; stripe.position.x = bx + off; g.add(stripe);
    }
    // 少しほどけた部分
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.36, 30, 10), rollMat);
    const pos = flap.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setZ(i, Math.sin(pos.getX(i) * 5.5) * 0.014 * (0.5 + (y + 0.18))); }
    flap.geometry.computeVertexNormals();
    flap.rotation.x = -0.33; flap.position.set(0, -R + 0.03, R + 0.01); flap.castShadow = true; g.add(flap);
    return { obj: g, size: Math.max(w, R * 2) * 1.3 };
  },

  netRoll({ color = 0x1d2124, mm = 16, thread = 1.2 }) {
    const g = new THREE.Group(); const w = 1.2, R = 0.135;
    const hex = "#" + color.toString(16).padStart(6, "0");
    const t = netTex(mm, thread, hex), tile = t.userData.tile;
    const mk = (uw, uh) => { const tt = t.clone(); tt.needsUpdate = true; tt.generateMipmaps = false; tt.minFilter = THREE.LinearFilter; tt.repeat.set(uw / tile, uh / tile); return new THREE.MeshStandardMaterial({ map: tt, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.02 }); };
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 56), body); roll.rotation.z = Math.PI / 2; roll.castShadow = roll.receiveShadow = true; g.add(roll);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, w + 0.04, 28), M.cream()); core.rotation.z = Math.PI / 2; g.add(core);
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.42, 2, 2), mk(w, 0.42));
    flap.rotation.x = -0.34; flap.position.set(0, -R + 0.05, R + 0.14); flap.castShadow = true; g.add(flap);
    const skin = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0015, R + 0.0015, w, 56, 1, true), mk(2 * Math.PI * R, w));
    skin.rotation.z = Math.PI / 2; g.add(skin);
    return { obj: g, size: w * 1.22 };
  },

  sheetRoll({ color = 0x1a1a1a }) {
    const g = new THREE.Group(); const w = 1.35, R = 0.11;
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.02, roughness: 0.55 });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 48), mat); roll.rotation.z = Math.PI / 2; roll.castShadow = true; g.add(roll);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, w + 0.04, 24), M.cream()); core.rotation.z = Math.PI / 2; g.add(core);
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.26, 20, 6), mat); flap.rotation.x = -0.4; flap.position.set(0, -R + 0.02, R); g.add(flap);
    return { obj: g, size: w * 1.25 };
  },
  crank({ big = false, small = false }) { // 手動巻き上げ機。鋳物の本体 + ハンドル + パイプ取付バンド + 巻き取り軸
    const g = new THREE.Group();
    const k = small ? 0.84 : 1;
    const cast = new THREE.MeshStandardMaterial({ color: 0xdfe1e0, metalness: 0.22, roughness: 0.52, envMapIntensity: 1.0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33383c, metalness: 0.3, roughness: 0.45 });

    const W = 0.15 * k, H = 0.17 * k, D = 0.095 * k;
    const body = box(W, H, D, cast, 0.014 * k); g.add(body);
    // 前面の一段落ちたフタとビス
    const lid = box(W * 0.78, H * 0.74, 0.008, cast, 0.01 * k); lid.position.set(0, H * 0.02, D / 2 + 0.002); g.add(lid);
    for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 12), dark);
      scr.rotation.x = Math.PI / 2; scr.position.set(x * W * 0.33, H * 0.02 + y * H * 0.29, D / 2 + 0.007); g.add(scr);
    }
    // 軸まわりのボス
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * k, 0.032 * k, 0.03, 28), cast);
    boss.rotation.z = Math.PI / 2; boss.position.set(W / 2 + 0.012, 0, 0); boss.castShadow = true; g.add(boss);
    // 巻き取り軸(φ22.2)と継手
    const shaftLen = big ? 0.78 : 0.48;
    const shaft = pipeHollow(0.0111, shaftLen, M.zinc()); shaft.rotation.z = Math.PI / 2;
    shaft.position.set(W / 2 + 0.03 + shaftLen / 2, 0, 0); g.add(shaft);
    const coup = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 24), M.steelDark());
    coup.rotation.z = Math.PI / 2; coup.position.set(W / 2 + 0.055, 0, 0); coup.castShadow = true; g.add(coup);
    if (big) { const coup2 = coup.clone(); coup2.position.x = W / 2 + 0.03 + shaftLen * 0.62; g.add(coup2); }
    // ハンドル(クランク)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.026, 24), dark);
    hub.rotation.x = Math.PI / 2; hub.position.set(0, H * 0.02, D / 2 + 0.022); hub.castShadow = true; g.add(hub);
    const arm = box(0.018, 0.15 * k, 0.014, dark, 0.005); arm.position.set(0, H * 0.02 - 0.07 * k, D / 2 + 0.03); g.add(arm);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.062, 24), M.orange());
    grip.rotation.x = Math.PI / 2; grip.position.set(0, H * 0.02 - 0.14 * k, D / 2 + 0.058); grip.castShadow = true; g.add(grip);
    const gcap = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 16, 12), dark); gcap.position.set(0, H * 0.02 - 0.14 * k, D / 2 + 0.09); g.add(gcap);
    // ハウスのパイプに留めるバンド
    const bandR = 0.0165;
    const saddle = clampOriented(bandR + 0.0008, 0.0026, 0.03, M.steelDark(), Math.PI * 1.2, "z", Math.PI / 2);
    saddle.position.set(-W / 2 - 0.02, -H * 0.18, 0); g.add(saddle);
    const plate = box(0.03, H * 0.86, 0.05, M.steelDark(), 0.004); plate.position.set(-W / 2 - 0.012, 0, 0); g.add(plate);
    for (const y of [-H * 0.3, H * 0.28]) { const bl = bolt(0.05, 0.0034); bl.rotation.z = Math.PI / 2; bl.position.set(-W / 2 - 0.012, y, 0); g.add(bl); }
    // ロックレバー
    const lev = box(0.05, 0.012, 0.012, dark, 0.004); lev.position.set(W * 0.18, -H / 2 - 0.012, 0); lev.rotation.z = -0.3; g.add(lev);
    return { obj: g, size: big ? 1.15 : small ? 0.62 : 0.82 };
  },

  panel({ kind = "std" }) { // 制御盤・環境制御の箱
    const g = new THREE.Group();
    const big = kind === "big";
    const W = big ? 0.34 : 0.26, H = big ? 0.46 : 0.34, D = big ? 0.13 : 0.1;
    const shell = new THREE.MeshStandardMaterial({ color: 0xe9eae7, metalness: 0.12, roughness: 0.46, envMapIntensity: 1.0 });
    const face = new THREE.MeshStandardMaterial({ color: 0xf3f4f1, metalness: 0.1, roughness: 0.38, envMapIntensity: 1.0 });
    const body = box(W, H, D, shell, 0.01); g.add(body);
    // 一段落ちた前面パネル(扉の見切り)
    const door = box(W * 0.92, H * 0.94, 0.012, face, 0.008); door.position.z = D / 2 - 0.002; g.add(door);
    const seam = box(W * 0.92, H * 0.94, 0.016, new THREE.MeshStandardMaterial({ color: 0xbfc4c0, roughness: 0.6 }), 0.008);
    seam.position.z = D / 2 - 0.006; seam.scale.set(1.02, 1.02, 1); g.add(seam);
    // 表示窓
    const scr = box(W * 0.62, H * 0.28, 0.007, M.screen(), 0.004); scr.position.set(0, H * 0.22, D / 2 + 0.007); g.add(scr);
    const bezel = box(W * 0.68, H * 0.34, 0.005, M.darkGrey(), 0.005); bezel.position.set(0, H * 0.22, D / 2 + 0.004); g.add(bezel);
    // ボタン
    const cols = big ? 4 : 3;
    for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.007, 20), j === 0 && i === 1 ? M.orange() : M.darkGrey());
      b.rotation.x = Math.PI / 2; b.position.set(-W * 0.26 + i * (W * 0.17), -H * 0.12 - j * 0.05, D / 2 + 0.011); b.castShadow = true; g.add(b);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 12), new THREE.MeshStandardMaterial({ color: 0x7FB069, emissive: 0x2f6b45, emissiveIntensity: 2 }));
    led.position.set(W * 0.34, -H * 0.12, D / 2 + 0.009); g.add(led);
    // 銘板(無地)
    const plate2 = box(W * 0.3, 0.03, 0.003, new THREE.MeshStandardMaterial({ color: 0xd7dad6, metalness: 0.4, roughness: 0.4 }));
    plate2.position.set(-W * 0.24, -H * 0.36, D / 2 + 0.008); g.add(plate2);
    // 取付耳
    for (const sgn of [-1, 1]) {
      const ear = box(0.03, H * 0.3, 0.006, shell, 0.004); ear.position.set(sgn * (W / 2 + 0.012), H * 0.18, -D / 2 + 0.01); g.add(ear);
      const hole = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0018, 8, 18), M.steelDark()); hole.position.set(sgn * (W / 2 + 0.012), H * 0.18, -D / 2 + 0.014); g.add(hole);
    }
    // 側面の放熱スリット
    for (let i = 0; i < 5; i++) { const sl = box(0.002, 0.004, D * 0.6, new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.7 })); sl.position.set(W / 2 - 0.001, -H * 0.3 + i * 0.011, 0); g.add(sl); }
    if (kind === "cloud") {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.17, 14), M.black()); ant.position.set(W * 0.34, H / 2 + 0.085, 0); ant.rotation.z = -0.16; ant.castShadow = true; g.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 10), M.black()); tip.position.set(W * 0.34 - 0.027, H / 2 + 0.17, 0); g.add(tip);
    }
    if (kind === "irrigation") {
      const man = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, W * 1.15, 24), M.darkGrey());
      man.rotation.z = Math.PI / 2; man.position.y = -H / 2 - 0.075; man.castShadow = true; g.add(man);
      for (const x of [-W * 0.32, 0, W * 0.32]) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.055, 20), M.orange()); v.position.set(x, -H / 2 - 0.045, 0); v.castShadow = true; g.add(v);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 20), M.darkGrey()); cap.position.set(x, -H / 2 - 0.018, 0); g.add(cap);
      }
    }
    if (kind === "dial") {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 30), M.darkGrey()); d.rotation.x = Math.PI / 2; d.position.set(0, -H * 0.3, D / 2 + 0.012); d.castShadow = true; g.add(d);
      const knob = box(0.006, 0.028, 0.006, M.orange()); knob.position.set(0.011, -H * 0.28, D / 2 + 0.02); knob.rotation.z = -0.6; g.add(knob);
    }
    for (const x of [-W * 0.25, W * 0.25]) {
      const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.03, 18), M.darkGrey()); gl.position.set(x, -H / 2 - 0.013, 0); gl.castShadow = true; g.add(gl);
    }
    return { obj: g, size: Math.max(W, H) * 1.5 };
  },

  sensor({ }) { // 環境測定器(温湿度・CO₂・日射)
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xeceded, metalness: 0.1, roughness: 0.44, envMapIntensity: 1.0 });
    const body = box(0.12, 0.2, 0.07, shell, 0.01); g.add(body);
    const scr = box(0.085, 0.055, 0.006, M.screen(), 0.003); scr.position.set(0, 0.05, 0.039); g.add(scr);
    const bez = box(0.095, 0.065, 0.004, M.darkGrey(), 0.004); scr.position.z = 0.041; bez.position.set(0, 0.05, 0.037); g.add(bez);
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 18), i ? M.orange() : M.darkGrey()); b.rotation.x = Math.PI / 2; b.position.set(-0.02 + i * 0.04, -0.005, 0.038); g.add(b); }
    // 日射よけ(重ね皿)
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.047 - i * 0.0025, 0.014, 32, 1, true), shell);
      d.position.y = -0.062 - i * 0.017; d.castShadow = d.receiveShadow = true; g.add(d);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 12), M.steelDark()); rod.position.y = -0.1; g.add(rod);
    // 取付金具
    const brk = box(0.05, 0.012, 0.05, M.steelDark(), 0.004); brk.position.set(0, -0.158, 0); g.add(brk);
    const clamp = clampOriented(0.0135, 0.0026, 0.03, M.steelDark(), Math.PI * 1.25, "z", -Math.PI / 2);
    clamp.position.set(0, -0.178, 0); g.add(clamp);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.04, -0.05, 0), new THREE.Vector3(0.09, -0.11, 0.04), new THREE.Vector3(0.16, -0.19, -0.02)]), 40, 0.0042, 10), M.black());
    cable.castShadow = true; g.add(cable);
    return { obj: g, size: 0.46 };
  },

  fan({ }) { // 循環扇(吊り下げ)
    const g = new THREE.Group();
    const R = 0.2;
    const guard = new THREE.MeshStandardMaterial({ color: 0xc6ccd0, metalness: 0.78, roughness: 0.32, envMapIntensity: 1.1 });
    for (const z of [0.02, -0.075]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.011, 12, 56), guard); ring.position.z = z; ring.castShadow = true; g.add(ring); }
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.006, 10, 48), guard); ring2.position.z = 0.02; g.add(ring2);
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, R * 2, 6), guard); bar.rotation.z = a; bar.position.z = 0.02; g.add(bar); }
    // モーター
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.13, 32), M.white()); hub.rotation.x = Math.PI / 2; hub.position.z = -0.03; hub.castShadow = true; g.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.02, 32), M.darkGrey()); cap.rotation.x = Math.PI / 2; cap.position.z = -0.1; g.add(cap);
    // 羽根(3枚、ガードの内側)
    const blade = new THREE.MeshStandardMaterial({ color: 0xeeede7, metalness: 0.06, roughness: 0.38, side: THREE.DoubleSide });
    const bs = new THREE.Shape();
    bs.moveTo(0, -0.035);
    bs.quadraticCurveTo(0.06, -0.05, 0.115, -0.03);
    bs.quadraticCurveTo(0.132, 0.0, 0.112, 0.032);
    bs.quadraticCurveTo(0.06, 0.052, 0, 0.038);
    bs.closePath();
    const bGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.0035, bevelEnabled: false, curveSegments: 16 });
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 3) * Math.PI * 2;
      const m = new THREE.Mesh(bGeo, blade);
      m.position.x = 0.055; m.rotation.x = 0.6; m.castShadow = true; m.receiveShadow = true;
      holder.add(m); holder.position.z = -0.035; g.add(holder);
    }
    // 吊り金具
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 10, 24, Math.PI * 1.35), M.steelDark()); yoke.position.y = R + 0.04; yoke.castShadow = true; g.add(yoke);
    const stem = box(0.016, 0.05, 0.016, M.steelDark(), 0.003); stem.position.y = R + 0.012; g.add(stem);
    const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, -R + 0.02, -0.1), new THREE.Vector3(0.1, -R - 0.03, -0.14), new THREE.Vector3(0.2, -R - 0.01, -0.06)]), 40, 0.0045, 10), M.black());
    g.add(cord);
    return { obj: g, size: 0.58 };
  },

  heater({ }) { // 施設園芸用 温風暖房機
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xe6e8e5, metalness: 0.14, roughness: 0.45, envMapIntensity: 1.0 });
    const W = 0.52, H = 0.42, D = 0.36;
    const body = box(W, H, D, shell, 0.018); g.add(body);
    // 温風の吹き出し口
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.16, 36), M.zinc());
    duct.rotation.z = Math.PI / 2; duct.position.set(W / 2 + 0.07, 0.03, 0); duct.castShadow = true; g.add(duct);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.006, 10, 36), M.zinc()); lip.rotation.y = Math.PI / 2; lip.position.set(W / 2 + 0.145, 0.03, 0); g.add(lip);
    // 吸気グリル(ルーバー)
    for (let i = 0; i < 7; i++) { const sl = box(0.14, 0.008, 0.006, M.darkGrey()); sl.position.set(-W * 0.3, -H * 0.3 + i * 0.026, D / 2 + 0.004); sl.rotation.x = 0.35; g.add(sl); }
    const grillFrame = box(0.16, 0.21, 0.008, shell, 0.006); grillFrame.position.set(-W * 0.3, -H * 0.09, D / 2 + 0.001); g.add(grillFrame);
    // 操作パネル
    const cp = box(0.15, 0.1, 0.012, shell, 0.006); cp.position.set(W * 0.16, H * 0.2, D / 2 + 0.004); g.add(cp);
    const cpScr = box(0.09, 0.04, 0.005, M.screen(), 0.003); cpScr.position.set(W * 0.16, H * 0.23, D / 2 + 0.012); g.add(cpScr);
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16), i === 1 ? M.orange() : M.darkGrey()); b.rotation.x = Math.PI / 2; b.position.set(W * 0.16 - 0.03 + i * 0.03, H * 0.16, D / 2 + 0.012); g.add(b); }
    // 煙突
    const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 28), M.zinc()); flue.position.set(-W * 0.18, H / 2 + 0.11, -D * 0.2); flue.castShadow = true; g.add(flue);
    // 燃料配管
    const fuel = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-W / 2, -H * 0.28, 0.04), new THREE.Vector3(-W / 2 - 0.09, -H * 0.34, 0.02), new THREE.Vector3(-W / 2 - 0.14, -H * 0.5, -0.05)]), 40, 0.008, 12), M.steelDark());
    g.add(fuel);
    // 脚
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = box(0.05, 0.1, 0.05, M.darkGrey(), 0.004); leg.position.set(sx * W * 0.38, -H / 2 - 0.05, sz * D * 0.33); g.add(leg); }
    const rail = box(W * 0.9, 0.03, 0.05, M.darkGrey(), 0.004); rail.position.set(0, -H / 2 - 0.085, 0); g.add(rail);
    return { obj: g, size: 0.95 };
  },

  co2({ }) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.52, 36), M.white()); body.castShadow = true; g.add(body);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.15, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.white()); top.position.y = 0.26; g.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.06, 36), M.orange()); band.position.y = 0.12; g.add(band);
    const pipe = tube(0.02, 0.22, M.zinc(), 20); pipe.position.set(0, 0.44, 0); g.add(pipe);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.05, 36), M.darkGrey()); base.position.y = -0.28; g.add(base);
    return { obj: g, size: 0.8 };
  },
  led({ }) {
    const g = new THREE.Group();
    const bar = box(0.9, 0.055, 0.05, M.alu(), 0.008); g.add(bar);
    const lens = box(0.86, 0.03, 0.012, new THREE.MeshStandardMaterial({ color: 0xfdf6e3, emissive: 0xffe9b0, emissiveIntensity: 1.6, roughness: 0.3 })); lens.position.y = -0.028; g.add(lens);
    for (const s of [-1, 1]) { const br = box(0.02, 0.06, 0.05, M.darkGrey()); br.position.set(s * 0.4, 0.05, 0); g.add(br); }
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.45, 0.02, 0), new THREE.Vector3(0.56, 0.05, 0.03), new THREE.Vector3(0.62, -0.02, -0.02)]), 30, 0.004, 8), M.black()); g.add(cable);
    return { obj: g, size: 1.05 };
  },
  door({ }) {
    const g = new THREE.Group();
    const fw = 1.0, fh = 1.9, t = 0.075;
    const frameMat = M.alu();
    for (const [x, y, w, h] of [[-fw / 2, 0, t, fh], [fw / 2, 0, t, fh], [0, fh / 2 - t / 2, fw, t], [0, -fh / 2 + t / 2, fw, t]]) {
      const b = box(w, h, 0.05, frameMat, 0.004); b.position.set(x, y, 0); g.add(b);
    }
    const panelMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e6ef, metalness: 0, roughness: 0.16, transmission: 0.55, thickness: 0.05, ior: 1.46, side: THREE.DoubleSide, clearcoat: 0.7 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(fw - t, fh - t * 2), panelMat); panel.position.z = 0.004; g.add(panel);
    for (let i = 0; i < 2; i++) { const bar = box(fw - t, 0.045, 0.038, frameMat, 0.003); bar.position.y = -fh / 2 + 0.5 + i * 0.62; g.add(bar); }
    const mid = box(0.045, fh - t * 2, 0.038, frameMat, 0.003); g.add(mid);
    const handle = box(0.028, 0.2, 0.05, M.darkGrey(), 0.006); handle.position.set(fw / 2 - 0.16, 0, 0.045); g.add(handle);
    const railTop = box(fw + 0.45, 0.05, 0.06, frameMat, 0.005); railTop.position.y = fh / 2 + 0.08; g.add(railTop);
    for (const sx of [-0.28, 0.28]) {
      const hang = box(0.05, 0.1, 0.01, M.steelDark()); hang.position.set(sx, fh / 2 + 0.045, 0.03); g.add(hang);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 22), M.steelDark());
      wheel.rotation.z = Math.PI / 2; wheel.position.set(sx, fh / 2 + 0.08, 0); wheel.castShadow = true; g.add(wheel);
    }
    return { obj: g, size: 2.4 };
  },

  roofVent({ }) {
    const g = new THREE.Group();
    const fw = 0.9, fh = 0.5;
    const frameMat = M.zinc();
    for (const [x, y, w, h] of [[-fw / 2, 0, 0.04, fh], [fw / 2, 0, 0.04, fh], [0, fh / 2, fw, 0.04], [0, -fh / 2, fw, 0.04]]) { const b = box(w, h, 0.035, frameMat, 0.003); b.position.set(x, y, 0); g.add(b); }
    const panelMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e6ef, metalness: 0, roughness: 0.16, transmission: 0.55, thickness: 0.04, ior: 1.46, side: THREE.DoubleSide, clearcoat: 0.7 });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.05, fh - 0.05), panelMat); g.add(pane);
    const hinge = box(fw, 0.03, 0.03, M.steelDark()); hinge.position.y = fh / 2 + 0.02; g.add(hinge);
    const arm = box(0.024, 0.3, 0.024, frameMat); arm.position.set(0.2, -fh / 2 - 0.1, -0.06); arm.rotation.z = 0.45; g.add(arm);
    const gearbox = box(0.11, 0.11, 0.07, M.white(), 0.008); gearbox.position.set(-0.28, -fh / 2 - 0.12, -0.02); g.add(gearbox);
    const shaft = tube(0.009, 0.55, frameMat, 18); shaft.rotation.z = Math.PI / 2; shaft.position.set(0.1, -fh / 2 - 0.12, -0.02); g.add(shaft);
    const handle = box(0.014, 0.11, 0.014, M.darkGrey()); handle.position.set(-0.28, -fh / 2 - 0.22, 0.02); g.add(handle);
    g.rotation.x = -0.22;
    return { obj: g, size: 1.0 };
  },

  curtainDrive({ }) { // 電動カーテン開閉装置(ギヤードモーター + 制御盤)
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xe8e9e6, metalness: 0.16, roughness: 0.44, envMapIntensity: 1.0 });
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.2, 36), shell);
    motor.rotation.z = Math.PI / 2; motor.castShadow = true; g.add(motor);
    for (let i = 0; i < 12; i++) { // 放熱フィン
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.0035, 8, 36), shell);
      f.rotation.y = Math.PI / 2; f.position.x = -0.09 + i * 0.016; g.add(f);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.025, 36), M.darkGrey()); cap.rotation.z = Math.PI / 2; cap.position.x = 0.11; g.add(cap);
    // 減速機
    const gearbox = box(0.13, 0.16, 0.13, shell, 0.012); gearbox.position.x = -0.17; g.add(gearbox);
    const out = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 28), M.steelDark()); out.rotation.z = Math.PI / 2; out.position.set(-0.26, 0, 0); out.castShadow = true; g.add(out);
    // 出力軸
    const shaft = pipeHollow(0.0125, 0.46, M.zinc()); shaft.rotation.z = Math.PI / 2; shaft.position.x = -0.5; g.add(shaft);
    // 取付ベース
    const base = box(0.42, 0.014, 0.16, M.steelDark(), 0.005); base.position.set(-0.1, -0.1, 0); g.add(base);
    for (const x of [-0.26, 0.04]) { const bl = bolt(0.05, 0.0038); bl.position.set(x, -0.1, 0.05); g.add(bl); }
    // 制御盤
    const bx = box(0.15, 0.21, 0.075, shell, 0.01); bx.position.set(0.02, 0.24, 0); g.add(bx);
    const scr = box(0.095, 0.05, 0.005, M.screen(), 0.003); scr.position.set(0.02, 0.29, 0.04); g.add(scr);
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), i === 1 ? M.orange() : M.darkGrey()); b.rotation.x = Math.PI / 2; b.position.set(-0.008 + i * 0.028, 0.2, 0.04); g.add(b); }
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, 0.13, 0), new THREE.Vector3(0.05, 0.06, 0.03), new THREE.Vector3(0.04, 0.0, 0.06)]), 40, 0.005, 10), M.black());
    g.add(cable);
    return { obj: g, size: 0.85 };
  },

  curtainFabric({ color = 0xd8d8d2, metal = 0.35, stripe = false }) {
    const g = new THREE.Group(); const w = 1.2, R = 0.125;
    const opt = { color, metalness: metal, roughness: 0.45, side: THREE.DoubleSide };
    if (stripe) { const t = stripeTex(); const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(w / t.userData.tile, 2 * Math.PI * R / t.userData.tile); opt.map = tt; opt.color = 0xffffff; opt.metalness = 0.62; opt.roughness = 0.32; }
    const mat = new THREE.MeshStandardMaterial(opt);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w, 56), mat); roll.rotation.z = Math.PI / 2; roll.castShadow = roll.receiveShadow = true; g.add(roll);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, w + 0.04, 28), M.cream()); core.rotation.z = Math.PI / 2; g.add(core);
    const fopt = { ...opt };
    if (stripe) { const t2 = stripeTex(); const tt2 = t2.clone(); tt2.needsUpdate = true; tt2.repeat.set(w / t2.userData.tile, 0.36 / t2.userData.tile); fopt.map = tt2; fopt.metalness = 0.62; fopt.roughness = 0.32; }
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.36, 30, 10), new THREE.MeshStandardMaterial(fopt));
    const pos = flap.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 9) * 0.016);
    flap.geometry.computeVertexNormals(); flap.rotation.x = -0.4; flap.position.set(0, -R + 0.03, R + 0.03); flap.castShadow = true; g.add(flap);
    return { obj: g, size: w * 1.22 };
  },

  dripTube({ }) {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 260; i++) { const t = i / 260, a = t * Math.PI * 2 * 3.2, r = 0.17 - t * 0.02; pts.push(new THREE.Vector3(Math.cos(a) * r, (t - 0.5) * 0.11, Math.sin(a) * r)); }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 420, 0.009, 14, false), M.black()); coil.castShadow = true; g.add(coil);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.15, -0.05, 0.06), new THREE.Vector3(0.3, -0.06, 0.12), new THREE.Vector3(0.42, -0.06, 0.02)]), 60, 0.009, 14), M.black()); g.add(tail);
    for (let i = 0; i < 4; i++) { const em = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), M.orange()); em.position.set(0.28 + i * 0.04, -0.055, 0.09 - i * 0.02); g.add(em); }
    return { obj: g, size: 0.55 };
  },
  mist({ }) {
    const g = new THREE.Group();
    const pipe = tube(0.008, 0.5, M.black(), 20); pipe.rotation.z = Math.PI / 2; g.add(pipe);
    for (let i = -2; i <= 2; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.022, 16), M.orange()); t.position.set(i * 0.11, -0.018, 0); t.castShadow = true; g.add(t);
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 12), M.steel()); n.position.set(i * 0.11, -0.032, 0); g.add(n);
    }
    return { obj: g, size: 0.6 };
  },
  timer({ }) {
    const g = new THREE.Group();
    const body = box(0.1, 0.15, 0.06, M.white(), 0.012); g.add(body);
    const scr = box(0.07, 0.04, 0.005, M.screen(), 0.003); scr.position.set(0, 0.04, 0.033); g.add(scr);
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16), i === 1 ? M.orange() : M.darkGrey()); b.rotation.x = Math.PI / 2; b.position.set(-0.025 + i * 0.025, -0.02, 0.033); g.add(b); }
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 6), M.black()); nut.position.y = -0.09; g.add(nut);
    return { obj: g, size: 0.3 };
  },
  filter({ }) {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.17, 32), new THREE.MeshPhysicalMaterial({ color: 0xd6e2ea, transmission: 0.7, thickness: 0.6, roughness: 0.15, ior: 1.5 })); bowl.castShadow = true; g.add(bowl);
    const cart = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 24), M.orange()); g.add(cart);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 32), M.darkGrey()); head.position.y = 0.105; g.add(head);
    for (const s of [-1, 1]) { const port = tube(0.018, 0.07, M.darkGrey(), 20); port.rotation.z = Math.PI / 2; port.position.set(s * 0.085, 0.105, 0); g.add(port); }
    return { obj: g, size: 0.32 };
  },
  anchor({ }) {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 200; i++) { const t = i / 200, y = 0.3 - t * 0.6, a = t * Math.PI * 2 * 7, r = 0.028 * (1 - t * 0.15); pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    const helix = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 300, 0.0055, 10, false), M.zinc()); helix.castShadow = true; g.add(helix);
    const core = tube(0.006, 0.6, M.zinc(), 16); g.add(core);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 10, 26), M.zinc()); eye.position.y = 0.32; eye.rotation.y = Math.PI / 2; g.add(eye);
    return { obj: g, size: 0.72 };
  },
  brace({ dia = 25.4 }) {
    const g = new THREE.Group(); const r = dia / 2000;
    for (const sgn of [-1, 1]) { const p = pipeHollow(r, 0.34, M.zinc()); p.rotation.z = Math.PI / 2 + sgn * 0.62; g.add(p); }
    const plate = box(0.14, 0.13, 0.007, M.steelDark(), 0.014); plate.position.z = -r - 0.004; g.add(plate);
    const b1 = bolt(0.055, 0.0042); b1.rotation.x = Math.PI / 2; g.add(b1);
    for (const [x, y] of [[-0.045, 0.042], [0.045, -0.042]]) { const b2 = bolt(0.03, 0.0032); b2.rotation.x = Math.PI / 2; b2.position.set(x, y, -r); g.add(b2); }
    return { obj: g, size: 0.42 };
  },

  tiebar({ dia = 31.8 }) {
    const g = new THREE.Group(); const r = dia / 2000;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.34, r, 16, 40, Math.PI * 0.8), M.zinc()); arc.position.y = -0.05; arc.castShadow = true; g.add(arc);
    const bar = pipeHollow(r * 0.85, 0.54, M.zinc()); bar.rotation.z = Math.PI / 2; bar.position.y = 0.06; g.add(bar);
    for (const s of [-1, 1]) { const clamp = box(0.035, 0.05, 0.04, M.steelDark(), 0.005); clamp.position.set(s * 0.26, 0.08, 0); g.add(clamp); const bl = bolt(0.05); bl.position.set(s * 0.26, 0.08, 0); bl.rotation.x = Math.PI / 2; g.add(bl); }
    return { obj: g, size: 0.72 };
  },
  gutter({ }) {
    const g = new THREE.Group(); const len = 1.0;
    const prof = new THREE.Shape();
    prof.moveTo(-0.16, 0.09); prof.lineTo(-0.16, 0.0); prof.quadraticCurveTo(-0.16, -0.05, -0.11, -0.05);
    prof.lineTo(0.11, -0.05); prof.quadraticCurveTo(0.16, -0.05, 0.16, 0.0); prof.lineTo(0.16, 0.09);
    prof.lineTo(0.145, 0.09); prof.lineTo(0.145, 0.01); prof.quadraticCurveTo(0.145, -0.035, 0.1, -0.035);
    prof.lineTo(-0.1, -0.035); prof.quadraticCurveTo(-0.145, -0.035, -0.145, 0.01); prof.lineTo(-0.145, 0.09); prof.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false }), M.zinc());
    m.rotation.y = Math.PI / 2; m.position.x = -len / 2; m.castShadow = m.receiveShadow = true; g.add(m);
    return { obj: g, size: len * 1.2 };
  },
  fence({ }) {
    const g = new THREE.Group();
    for (let i = -1; i <= 1; i++) { const post = box(0.022, 0.85, 0.022, M.black()); post.position.set(i * 0.42, 0, 0); g.add(post); }
    for (let j = 0; j < 3; j++) { const wire = tube(0.0018, 1.0, M.steel(), 8); wire.rotation.z = Math.PI / 2; wire.position.y = -0.3 + j * 0.28; g.add(wire); }
    const unit = box(0.16, 0.2, 0.08, M.orange(), 0.012); unit.position.set(0, 0.5, 0); g.add(unit);
    const panel2 = box(0.22, 0.16, 0.012, new THREE.MeshStandardMaterial({ color: 0x14243a, metalness: 0.5, roughness: 0.2 })); panel2.position.set(0, 0.66, -0.02); panel2.rotation.x = -0.5; g.add(panel2);
    return { obj: g, size: 1.25 };
  },
  doorRail({ }) { // ドアレール + 戸車
    const g = new THREE.Group(); const len = 0.62;
    const prof = new THREE.Shape();
    prof.moveTo(-0.032, 0); prof.lineTo(0.032, 0); prof.lineTo(0.032, 0.014); prof.lineTo(0.012, 0.014);
    prof.lineTo(0.012, 0.042); prof.lineTo(-0.012, 0.042); prof.lineTo(-0.012, 0.014); prof.lineTo(-0.032, 0.014); prof.closePath();
    const railM = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false }), M.alu());
    railM.rotation.y = Math.PI / 2; railM.position.x = -len / 2; railM.castShadow = railM.receiveShadow = true; g.add(railM);
    for (const x of [-0.15, 0.15]) {
      const hanger = new THREE.Group();
      const plate = box(0.06, 0.09, 0.008, M.steelDark(), 0.006); plate.position.set(0, -0.055, 0.024); hanger.add(plate);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.011, 26), M.steelDark());
        w.rotation.z = Math.PI / 2; w.position.set(s * 0.026, 0.02, 0); w.castShadow = true; hanger.add(w);
        const axle = tube(0.004, 0.05, M.steel(), 12); axle.rotation.z = Math.PI / 2; axle.position.y = 0.02; hanger.add(axle);
      }
      hanger.position.x = x; g.add(hanger);
    }
    return { obj: g, size: len * 1.2 };
  },
  dripCatch({ }) { // ナイスキャッチ: フィルム止め継手の下に付ける雨だれ受け(W14×D8×H1cm)
    const g = new THREE.Group();
    const W = 0.14, D = 0.08, H = 0.012, wall = 0.0018;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.04, roughness: 0.36, envMapIntensity: 1.0 });
    const sh = new THREE.Shape();
    sh.moveTo(-D / 2, 0); sh.lineTo(D / 2, 0); sh.lineTo(D / 2, H); sh.lineTo(D / 2 - wall, H);
    sh.lineTo(D / 2 - wall, wall); sh.lineTo(-D / 2 + wall, wall); sh.lineTo(-D / 2 + wall, H); sh.lineTo(-D / 2, H); sh.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 2 }), mat);
    body.rotation.y = Math.PI / 2; body.position.x = -W / 2; body.castShadow = body.receiveShadow = true; g.add(body);
    // 端の立ち上がり(水をためる側板)
    for (const sgn of [-1, 1]) { const end = box(0.003, H, D, mat); end.position.set(sgn * (W / 2 - 0.0015), H / 2, 0); g.add(end); }
    // ホース口(内径16φ)
    const nip = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.028, 28), mat);
    nip.rotation.z = Math.PI / 2; nip.position.set(-W / 2 - 0.014, H * 0.5, 0); nip.castShadow = true; g.add(nip);
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0112, 0.0016, 8, 28), mat); rib.rotation.y = Math.PI / 2; rib.position.set(-W / 2 - 0.024, H * 0.5, 0); g.add(rib);
    // 取り付けのツメ
    for (const x of [-W * 0.28, W * 0.28]) { const clip = box(0.008, 0.008, 0.016, mat); clip.position.set(x, H + 0.003, -D / 2 + 0.008); clip.rotation.x = 0.3; g.add(clip); }
    return { obj: g, size: W * 1.5 };
  },
  boxPack({ label = "" }) { // 箱入り金具など
    const g = new THREE.Group();
    const b = box(0.3, 0.2, 0.2, M.cream(), 0.006); g.add(b);
    const tape = box(0.31, 0.03, 0.201, M.white()); tape.position.y = 0.06; g.add(tape);
    return { obj: g, size: 0.45 };
  }
};
export { M };
