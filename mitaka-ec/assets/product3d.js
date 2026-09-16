// 商品1点の実時間3D。撮影スタジオ(scripts/product-photo)と同じ立体・同じ照明を、ページの中で回して見せる。
// 背景は描かず(透明)、CSSの背景紙(.paper)の上に置く。読めない環境では呼び出し側が黒ホリのJPGに戻す。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BUILDERS } from "../scripts/product-photo/shapes.js";
import { SHOTS } from "../scripts/product-photo/map.js";

export function hasShape(id) { return !!SHOTS[id]; }

const DIRS = {
  std: new THREE.Vector3(0.60, 0.36, 0.71).normalize(),
  long: new THREE.Vector3(0.84, 0.30, 0.45).normalize(),
  flat: new THREE.Vector3(0.32, 0.74, 0.59).normalize(),
  bundle: new THREE.Vector3(0.88, 0.36, 0.31).normalize()
};

export function createProductViewer(container, id, options = {}) {
  const shot = SHOTS[id];
  if (!shot || !BUILDERS[shot.b]) return { ok: false };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch { return { ok: false }; }
  const gl = renderer.getContext();
  if (!gl) return { ok: false };
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, options.maxPixelRatio || 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(27, 4 / 3, 0.01, 400);

  // 床: 影だけ受ける
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.30 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // 接地影
  const blobTex = (() => {
    const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d");
    const grd = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, "rgba(0,0,0,0.62)"); grd.addColorStop(0.42, "rgba(0,0,0,0.34)"); grd.addColorStop(0.74, "rgba(0,0,0,0.09)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grd; x.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.35 }));
  blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2; scene.add(blob);

  // 照明はスタジオの黒ホリと同じ
  const key = new THREE.DirectionalLight(0xfff6ee, 2.1);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.01; key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xeaf1ff, 0.30);
  const rim = new THREE.DirectionalLight(0xffffff, 2.4);
  const rim2 = new THREE.DirectionalLight(0xdce6ff, 1.2);
  const amb = new THREE.AmbientLight(0xffffff, 0.04);
  scene.add(key, key.target, fill, fill.target, rim, rim.target, rim2, rim2.target, amb);

  // 立体(撮影と同じ並べ方)
  const make = () => BUILDERS[shot.b]({ ...(shot.p || {}) });
  const first = make();
  const group = new THREE.Group();
  const n = shot.count || 1;
  if (n === 1) group.add(first.obj);
  else {
    const s = first.size;
    const spots = n === 2 ? [[-0.40, -0.26, -0.26], [0.42, 0.24, 0.30]] : [[-0.62, -0.30, -0.34], [0.02, 0.04, 0.14], [0.64, 0.34, -0.46]];
    [first, ...Array.from({ length: n - 1 }, make)].forEach((part, i) => { const [x, z, ry] = spots[i]; part.obj.position.set(x * s, 0, z * s); part.obj.rotation.y += ry; group.add(part.obj); });
  }
  let box = new THREE.Box3().setFromObject(group);
  group.position.y -= box.min.y;
  scene.add(group); group.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, 0.1);
  const L = span * 2.2;
  key.position.set(center.x - L * 0.70, center.y + L * 1.25, center.z + L * 1.00); key.target.position.copy(center);
  fill.position.set(center.x + L * 1.30, center.y + L * 0.45, center.z + L * 0.85); fill.target.position.copy(center);
  rim.position.set(center.x + L * 0.30, center.y + L * 1.00, center.z - L * 1.30); rim.target.position.copy(center);
  rim2.position.set(center.x - L * 1.20, center.y + L * 0.55, center.z - L * 0.90); rim2.target.position.copy(center);
  const sc = key.shadow.camera, half = span * 1.35;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = L * 0.15; sc.far = L * 6; sc.updateProjectionMatrix();
  const fx = Math.max(box.max.x - box.min.x, span * 0.12), fz = Math.max(box.max.z - box.min.z, span * 0.12), h = box.max.y - box.min.y;
  blob.position.set(center.x + fx * 0.10, 0.0006, center.z - fz * 0.06);
  blob.scale.set(fx * 1.85, fz * 1.85, 1);
  blob.material.opacity = 0.7 * (span > 1.6 ? 0.34 : 0.5) / (1 + Math.max(0, h / Math.max(fx, fz) - 1) * 0.6);
  floor.scale.setScalar(span * 40);

  // カメラ: 外接球で収める(回しても切れないように)
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = (DIRS[shot.view || "std"]).clone();
  const look = sphere.center.clone(); look.y -= sphere.radius * 0.06;
  camera.near = Math.max(span * 0.01, 0.004); camera.far = span * 80;
  const fitDist = () => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    return sphere.radius / Math.sin(Math.min(vf, hf)) * (options.fit || 1.02);
  };
  let visible = true, alive = true, raf = 0, idleUntil = 0;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(look);
  controls.enablePan = false;
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = options.autoRotate !== false; controls.autoRotateSpeed = options.autoRotateSpeed || 0.9;
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.rotateSpeed = 0.7;
  controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  let userTouched = false;
  controls.addEventListener("start", () => { userTouched = true; controls.autoRotate = false; wake(); });

  function resize() {
    const w = container.clientWidth || 300, hgt = container.clientHeight || Math.round(w * 0.75);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
    const d = fitDist();
    controls.minDistance = d * 0.55; controls.maxDistance = d * 1.6;
    if (!userTouched) camera.position.copy(look).addScaledVector(dir, d);
    wake();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  resize();

  // 描画: 見えている間だけ。触っていない時は自動回転が続く
  const io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible) wake(); }, { threshold: 0.05 });
  io.observe(container);
  function wake() { idleUntil = performance.now() + 1200; if (!raf) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0; if (!alive) return;
    const moving = controls.update();
    renderer.render(scene, camera);
    if (visible && (controls.autoRotate || moving || now < idleUntil)) raf = requestAnimationFrame(tick);
  }
  wake();

  return {
    ok: true,
    setAutoRotate(v) { controls.autoRotate = v; wake(); },
    reset() { userTouched = false; controls.autoRotate = options.autoRotate !== false; resize(); },
    dispose() {
      alive = false; if (raf) cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    }
  };
}
