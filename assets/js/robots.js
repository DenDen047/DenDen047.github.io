// 3D robots on the portfolio page.
// - .viewport[data-robot]      : shaded robot mini that idles and can be dragged around
// Each assets/models/<robot>.glb keeps the kinematic tree: a node named after each revolute joint rotates
// about the axis listed in <robot>.joints.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// home: resting joint angles (rad). move(t): joint offsets added to home at time t (s).
const ROBOTS = {
  go2: {
    home: Object.fromEntries(['FL', 'FR', 'RL', 'RR'].flatMap((l) => [[`${l}_thigh_joint`, 0.9], [`${l}_calf_joint`, -1.8]])),
    move(t) {
      const out = {};
      const phase = { FL: 0, RR: 0, FR: Math.PI, RL: Math.PI };
      for (const [leg, p] of Object.entries(phase)) {
        const lift = Math.max(0, Math.sin(t * 4 + p));
        out[`${leg}_thigh_joint`] = -0.15 * lift;
        out[`${leg}_calf_joint`] = -0.4 * lift;
      }
      return out;
    },
    view: { azimuth: 40, elevation: 18 },
  },
  r1: {
    home: {
      left_hip_pitch_joint: -0.25, right_hip_pitch_joint: -0.25,
      left_knee_joint: 0.5, right_knee_joint: 0.5,
      left_ankle_pitch_joint: -0.25, right_ankle_pitch_joint: -0.25,
      left_shoulder_roll_joint: 0.18, right_shoulder_roll_joint: -0.18,
      left_elbow_joint: 0.6, right_elbow_joint: 0.6,
    },
    move(t) {
      const s = Math.sin(t * 1.6);
      const wave = Math.max(0, Math.sin(t * 0.5)); // raise the right arm now and then
      return {
        waist_yaw_joint: 0.18 * s,
        head_yaw_joint: -0.3 * s,
        left_shoulder_pitch_joint: 0.25 * s,
        right_shoulder_pitch_joint: -0.25 * s - 1.2 * wave,
        right_shoulder_roll_joint: -0.4 * wave,
        right_elbow_joint: 0.5 * wave + 0.3 * wave * Math.sin(t * 7),
      };
    },
    view: { azimuth: 30, elevation: 10 },
  },
  g1: {
    home: {
      left_hip_pitch_joint: -0.15, right_hip_pitch_joint: -0.15,
      left_knee_joint: 0.3, right_knee_joint: 0.3,
      left_ankle_pitch_joint: -0.15, right_ankle_pitch_joint: -0.15,
      left_shoulder_pitch_joint: 0.2, left_shoulder_roll_joint: 0.2, left_elbow_joint: 1.28,
      right_shoulder_pitch_joint: 0.2, right_shoulder_roll_joint: -0.2, right_elbow_joint: 1.28,
    },
    // the right arm snaps out sideways, holds, and comes back
    move(t) {
      const p = (t * 0.35) % 1;
      const ease = (x) => x * x * (3 - 2 * x);
      const k = p < 0.12 ? ease(p / 0.12) : p < 0.5 ? 1 : p < 0.62 ? 1 - ease((p - 0.5) / 0.12) : 0;
      return {
        right_shoulder_roll_joint: -1.25 * k,
        right_shoulder_pitch_joint: -0.2 * k,
        right_elbow_joint: -1.28 * k,
        waist_yaw_joint: -0.15 * k,
        left_shoulder_pitch_joint: 0.06 * Math.sin(t * 1.6),
      };
    },
    view: { azimuth: 20, elevation: 10 },
  },
  openarm: {
    home: {
      openarm_left_joint2: -0.25, openarm_right_joint2: 0.25,
      openarm_left_joint4: 1.4, openarm_right_joint4: 1.4,
    },
    move(t) {
      const s = Math.sin(t * 1.2);
      const g = 0.35 * (1 + Math.sin(t * 2.4));
      return {
        openarm_left_joint1: 0.2 * s,
        openarm_right_joint1: 0.2 * s,
        openarm_left_joint4: 0.3 * s,
        openarm_right_joint4: -0.3 * s,
        openarm_left_joint7: 0.6 * s,
        openarm_right_joint7: -0.6 * s,
        openarm_left_finger_joint1: g, openarm_left_finger_joint2: g,
        openarm_right_finger_joint1: -g, openarm_right_finger_joint2: -g,
      };
    },
    view: { azimuth: 25, elevation: 14 },
  },
  wildpose: {
    home: {},
    // pans to follow an animal, pauses, tilts a little; roll stays level like a stabiliser
    move(t) {
      return {
        pan_joint: 0.6 * Math.sin(t * 0.45) + 0.15 * Math.sin(t * 1.3),
        tilt_joint: 0.12 * Math.sin(t * 0.7 + 1),
        roll_joint: 0.03 * Math.sin(t * 0.9),
      };
    },
    view: { azimuth: 55, elevation: 14 },
  },
};

const loader = new GLTFLoader();

// Load a robot, put it in the home pose and return a y-up group centred on its bounding box.
async function loadRobot(name) {
  const cfg = ROBOTS[name];
  const [gltf, joints] = await Promise.all([
    loader.loadAsync(`./assets/models/${name}.glb`),
    fetch(`./assets/models/${name}.joints.json`).then((r) => r.json()),
  ]);
  const robot = gltf.scene;
  robot.rotation.x = -Math.PI / 2; // ROS / MuJoCo are z-up, three.js is y-up
  const nodes = {};
  for (const [j, spec] of Object.entries(joints)) {
    const node = robot.getObjectByName(j);
    if (node) nodes[j] = { node, axis: new THREE.Vector3(...spec.axis).normalize(), lo: spec.lower, hi: spec.upper };
  }
  const pose = (t) => {
    const offs = t === null ? {} : cfg.move(t);
    for (const [j, n] of Object.entries(nodes)) {
      const a = THREE.MathUtils.clamp((cfg.home[j] ?? 0) + (offs[j] ?? 0), n.lo, n.hi);
      n.node.quaternion.setFromAxisAngle(n.axis, a);
    }
  };
  pose(null);
  const pivot = new THREE.Group();
  pivot.add(robot);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  robot.position.sub(box.getCenter(new THREE.Vector3()));
  box.translate(box.getCenter(new THREE.Vector3()).negate());
  pivot.updateMatrixWorld(true);
  return { pivot, robot, pose, box, radius: box.getBoundingSphere(new THREE.Sphere()).radius, cfg };
}

// Renderer, camera framing, drag-to-orbit and a render loop that only runs while the element is on screen.
function stage(el, radius, view, tick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.prepend(renderer.domElement);
  el.querySelector('.loading')?.remove();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, radius * 0.1, radius * 20);
  const az = THREE.MathUtils.degToRad(view.azimuth);
  const elev = THREE.MathUtils.degToRad(view.elevation);
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.12;
  camera.position.set(dist * Math.cos(elev) * Math.sin(az), dist * Math.sin(elev), dist * Math.cos(elev) * Math.cos(az));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.autoRotateSpeed = 1.6;
  renderer.domElement.style.touchAction = 'pan-y'; // keep vertical page scroll on phones

  const resize = () => {
    const { width, height } = el.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(el);
  resize();

  let visible = false;
  let hovering = false;
  el.addEventListener('pointerenter', () => { hovering = true; });
  el.addEventListener('pointerleave', () => { hovering = false; });
  const clock = new THREE.Clock();
  let t = 0;
  const frame = () => {
    if (!visible) return;
    const dt = clock.getDelta();
    const still = reduceMotion.matches;
    controls.autoRotate = !still && !hovering;
    if (!still) t += dt;
    tick(still ? null : t);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was) { clock.getDelta(); requestAnimationFrame(frame); }
  }).observe(el);
  return { renderer, scene, camera };
}

async function mountRobot(el) {
  const r = await loadRobot(el.dataset.robot);
  // the GLBs carry no normals: smooth within a part, keep edges sharper than 35°
  r.robot.traverse((o) => {
    if (o.isMesh) o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35));
  });
  const { renderer, scene } = stage(el, r.radius, r.cfg.view, (t) => { if (t !== null) r.pose(t); });
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 3);
  scene.add(sun, r.pivot);

  // soft contact shadow under the feet
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const size = r.box.getSize(new THREE.Vector3());
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.3, size.z * 1.3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = r.box.min.y + 0.001;
  scene.add(shadow);
}

const mountOnView = (selector, fn, rootMargin) => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      fn(e.target).catch((err) => {
        console.error(err);
        const l = e.target.querySelector('.loading');
        if (l) l.textContent = document.documentElement.lang === 'en' ? 'Could not load the 3D model' : '3D を読み込めませんでした';
      });
    }
  }, { rootMargin });
  document.querySelectorAll(selector).forEach((el) => io.observe(el));
};
mountOnView('.viewport[data-robot]', mountRobot, '200px');
