import * as THREE from "three";
import { CONFIG } from "./config.js";
import { World } from "./world.js";
import { createClue } from "./clues.js";
import { Trail } from "./trail.js";
import { MemoryRoom } from "./room.js";
import { BirthdaySong, SceneMusic, LoopSound, playCrash } from "./audio.js";
import { Chaser } from "./chaser.js";
import { Joystick, Look, Steps, Keys, requestSensors } from "./controls.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
// ?scene=street opens one of the extra scenes; without it, the birthday corridor scenario
const SC = CONFIG.scenes?.[params.get("scene")] ?? CONFIG.scenario;
SC.clues ??= [];
const ui = { ...CONFIG.ui, ...(SC.ui || {}) };
const DEG = Math.PI / 180;

/* ── renderer / scene ─────────────────────────────────────── */
const stage = $("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 60);
scene.add(camera);

// `here` = the scene she's standing in right now. It starts as SC, and a portal photo
// can swap it for another scene (and back) without reloading the page or the song.
let here = SC;
let reality = false;
const makeFog = () => (here.fog === null ? null : new THREE.Fog(BG, ...(here.fog || [9, 24])));
function applyLook() {
  BG.set(here.background ?? 0x1a1028);
  scene.background = reality ? null : BG;
  scene.fog = reality ? null : makeFog();
  camera.far = here.far || 60;
  camera.updateProjectionMatrix();
}
applyLook();

const homeWorld = new World(scene);
let world = homeWorld;
const portalWorlds = {}; // name → Promise<World>, loaded once
const portal = { busy: false, saved: null, name: null };
const sceneMusic = {}; // name → SceneMusic (each scene's own soundtrack)
const musicFor = (name) => (sceneMusic[name] ??= new SceneMusic(song, CONFIG.scenes?.[name]?.music));
const sceneName = () => portal.name || params.get("scene"); // which extra scene she's in, if any

// a scene can have something that hunts her (the street does): built once per scene config
const _rel = new THREE.Vector3();
function startChase(sc) {
  if (!sc._chaser) return;
  sc._chaser.reset(performance.now());
  sc._chaser.voice?.start(); // silent at first: the loop gets louder as it closes in
}
function stopChase(sc, fade = 0.4) {
  sc._chaser?.hide();
  sc._chaser?.voice?.stop(fade);
}

async function prepareChaser(sc) {
  if (!sc.chaser || sc._chaser) return;
  const c = new Chaser({ scene, cfg: sc.chaser });
  await c.load();
  if (sc.chaser.sound) c.voice = new LoopSound(song, sc.chaser.sound, { reverb: sc.chaser.reverb ?? 0.75 }); // its sound, on loop
  if (sc.chaser.jumpscare) {
    // preload so the scare is instant, never a blank flash
    const im = new Image();
    im.src = sc.chaser.jumpscare;
    c.jumpscareUrl = sc.chaser.jumpscare;
  }
  sc._chaser = c;
}
const song = new BirthdaySong({ src: CONFIG.song, loop: CONFIG.loopSong });
let room, trail, look, joy, steps, keys;
let clues = [];

const state = {
  phase: "intro", // intro → explore → room
  player: { x: SC.start[0], z: SC.start[2] },
  stepQueue: 0, // metres still to walk from real steps
  bob: 0,
  collected: 0,
  lastNotYet: 0,
};
if (DEBUG) window.__dbg = { get couch() { return couchSplat; }, sceneMusic, state, get world() { return world; }, camera, get clues() { return clues; }, get room() { return room; }, get look() { return look; }, song, goThrough: (n) => goThrough(n), goBack: () => goBack(), portal };

/* ── start: no tutorial, she's already standing in the 3D world behind one box ── */
$("#startBtn").textContent = ui.introButton;
$("#progress .dots").innerHTML = SC.clues.map(() => '<span class="dot"></span>').join("");
$("#progress").hidden = SC.clues.length === 0;
updateProgress();

// Start downloading the scan while she reads the intro.
let loadProgress = 0;
const ready = (async () => {
  await homeWorld.load(SC, (p) => (loadProgress = p));
  if (SC.room?.couch) {
    homeWorld.cutBox(SC.room.couch.cutBox); // take the scanned armchair out…
    loadCouch(SC.room.couch); // …and stream in the 3D capture of it (doesn't hold up the start)
  }
  clues = await Promise.all(SC.clues.map((c, i) => createClue(c, i)));
  clues.forEach((c) => scene.add(c.object));
  trail = new Trail(scene, world);
  if (SC.room) {
    room = new MemoryRoom({ config: CONFIG, scene, camera });
    await room.build();
  }
  prepareMinimap(homeWorld);
  await prepareChaser(SC); // only when a scene with a chaser is opened directly (?scene=street)
  showPreview();
})();

// Before the tap: the world is already there behind the box, at the start spot,
// with the view slowly drifting so it's clearly alive.
function showPreview() {
  if (state.phase !== "intro") return;
  const s = homeWorld.nearestWalkable(SC.start[0], SC.start[2]);
  camera.position.set(s.x, SC.eyeHeight, s.z);
  const t0 = performance.now();
  renderer.setAnimationLoop((now) => {
    if (state.phase !== "intro") return;
    const t = (now - t0) / 1000;
    camera.rotation.set(Math.sin(t * 0.21) * 0.04 - 0.03, SC.startHeading * DEG + Math.sin(t * 0.13) * 0.18, 0, "YXZ");
    camera.updateMatrixWorld();
    clues.forEach((c) => c.update(now, 0.016, camera));
    renderer.render(scene, camera);
  });
}
ready.catch((e) => {
  console.error(e);
  showError("The 3D world couldn't load. Check the connection and reload 🙏");
});

$("#startBtn").addEventListener("click", start, { once: true });

async function start() {
  const btn = $("#startBtn");
  btn.disabled = true;
  song.unlock(); // must happen inside the tap
  const sensors = await requestSensors(); // iPhone asks here
  try { await navigator.wakeLock?.request("screen"); } catch {}

  // only if she tapped before the world finished downloading: a thin bar under the box
  const bar = $("#loadBar");
  const tick = setInterval(() => {
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.round(loadProgress * 100)}%`;
  }, 100);
  await ready;
  clearInterval(tick);

  // controls
  look = new Look(camera, stage);
  joy = new Joystick($("#joystick"));
  keys = new Keys();
  steps = new Steps(() => {
    if (state.phase === "intro") return;
    state.stepQueue = Math.min(state.stepQueue + CONFIG.walk.stepLength, 2.5);
    const p = $("#stepPulse");
    p.textContent = "👣";
    p.classList.remove("go");
    void p.offsetWidth;
    p.classList.add("go");
  });
  if (!sensors.motion) { steps.enabled = false; $("#stepsBtn").classList.remove("on"); }

  // place her at the start, facing down the corridor
  const s = world.nearestWalkable(SC.start[0], SC.start[2]);
  state.player.x = s.x;
  state.player.z = s.z;
  camera.position.set(s.x, SC.eyeHeight, s.z);
  look.yaw = SC.startHeading * DEG;
  look.alignTo(SC.startHeading * DEG);
  look.update(true);

  $("#intro").classList.add("hide");
  setTimeout(() => $("#intro").remove(), 700);
  $("#hud").hidden = false;
  state.phase = "explore";
  if (ui.follow) toast(ui.follow, 3500);

  // hide toggles the phone can't support (checked after sensors had a moment to report)
  setTimeout(() => {
    if (!look.hasGyro) { $("#gyroBtn").disabled = true; look.gyro = false; }
    if (!steps.available) $("#stepsBtn").disabled = true;
  }, 1500);

  // a scene opened on its own (?scene=street) plays its own soundtrack straight away
  if (SC !== CONFIG.scenario && sceneName()) {
    musicFor(sceneName()).start(2);
    startChase(SC);
  }

  renderer.setAnimationLoop(loop);
}

/* ── toggles ──────────────────────────────────────────────── */
$("#stepsBtn").addEventListener("click", (e) => {
  steps.enabled = !steps.enabled;
  state.stepQueue = 0;
  e.currentTarget.classList.toggle("on", steps.enabled);
  toast(steps.enabled ? "Your real steps move you 👣" : "Steps off: use the circle to walk", 2200);
});
$("#gyroBtn").addEventListener("click", (e) => {
  look.setGyro(!look.gyro);
  e.currentTarget.classList.toggle("on", look.gyro);
  toast(look.gyro ? "Move your phone to look around" : "Drag the screen to look around", 2200);
});
let camStream = null;
$("#realBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    setReality(false);
    btn.classList.remove("on");
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const v = $("#camera");
    v.srcObject = camStream;
    await v.play().catch(() => {});
    setReality(true);
    btn.classList.add("on");
  } catch {
    toast("Camera not available", 2000);
  }
});
function setReality(on) {
  reality = on;
  $("#camera").hidden = !on;
  document.body.classList.toggle("reality", on);
  applyLook();
  world.setGhost(on);
}

/* ── taps: collect a clue in reach, or focus a photo in the room ── */
const ray = new THREE.Raycaster();
stage.addEventListener("click", (e) => {
  if (state.phase === "intro" || (look.lastDrag || 0) > 10) return;
  if (state.phase === "room") {
    if (portal.name) return; // inside a photo: nothing to tap
    const idx = room.tap(e.clientX, e.clientY);
    const target = idx != null && room.focused === idx ? CONFIG.photos[idx]?.portal : null;
    if (target) setTimeout(() => goThrough(target), 650); // let the photo fly up to her first
    return;
  }
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  for (const c of clues) {
    if (c.collected || c.distanceTo(state.player) > 4) continue;
    if (ray.intersectObjects(c.pickables, false).length) collect(c);
  }
});

/* ── game logic ───────────────────────────────────────────── */
function collect(clue) {
  if (!clue.collect(performance.now())) return;
  state.collected++;
  updateProgress();
  song.chime(state.collected);
  navigator.vibrate?.([30, 40, 70]);
  const card = $("#hintCard");
  card.hidden = false;
  card.querySelector(".num").textContent = state.collected;
  card.querySelector("p").textContent = clue.def.hint || "";
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";
  clearTimeout(collect._t);
  collect._t = setTimeout(() => (card.hidden = true), 7000);
}

function updateProgress() {
  const n = state.collected;
  document.querySelectorAll("#progress .dot").forEach((d, k) => d.classList.toggle("on", k < n));
  $("#progress .label").textContent = ui.progress(n, SC.clues.length);
}

function currentGoal() {
  if (state.phase === "room") return null;
  const next = clues.find((c) => !c.collected);
  if (next) return { x: next.def.position[0], z: next.def.position[2] };
  return SC.room ? { x: SC.room.trigger[0], z: SC.room.trigger[2] } : null;
}

let lastGoalKey = "";
function checkGoals(now) {
  for (const c of clues) if (!c.collected && c.distanceTo(state.player) < 1.0) collect(c);

  const goal = currentGoal();
  const key = goal ? `${goal.x},${goal.z}` : "none";
  if (key !== lastGoalKey) {
    lastGoalKey = key;
    trail.setGoal(goal);
    if (state.collected === clues.length && state.phase === "explore") setTimeout(() => toast(ui.toRoom, 3500), 2500);
  }

  if (!SC.room) return;
  const t = SC.room.trigger;
  if (state.phase === "explore" && !portal.name && Math.hypot(state.player.x - t[0], state.player.z - t[2]) < SC.room.radius) {
    const left = clues.length - state.collected;
    if (!SC.room.requireAllClues || left === 0) enterRoom(now);
    else if (now - state.lastNotYet > 5000) {
      state.lastNotYet = now;
      toast(ui.notYet(left), 3000);
    }
  }
}

/* ── the moment: she's in C306 ────────────────────────────── */
function enterRoom(now) {
  state.phase = "room";
  song.play(); // 🎶 starts right as she steps in
  navigator.vibrate?.([80, 60, 80, 60, 200]);
  trail.setGoal(null);
  room.enter(now, look.heading());

  const flash = $("#flash");
  flash.classList.remove("go");
  void flash.offsetWidth;
  flash.classList.add("go");

  $("#hintCard").hidden = true;
  $("#roomHud").hidden = false;
  setTimeout(() => !portal.name && $("#roomHint").classList.add("show"), 6000);
  setTimeout(() => $("#roomHint").classList.remove("show"), 14000);
  setTimeout(() => $("#replayBtn").classList.add("show"), 4000);

  // quietly download the photo-worlds now, so stepping into one is instant
  CONFIG.photos.forEach((p) => p.portal && loadPortalWorld(p.portal));
}

/* ── the armchair: a Gaussian-splat capture standing in for the scanned one ── */
let couchSplat = null;
async function loadCouch(cfg) {
  try {
    const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
    scene.add(new SparkRenderer({ renderer }));
    const m = new SplatMesh({ url: cfg.splat });
    m.position.fromArray(cfg.position);
    m.rotation.y = (cfg.rotationY || 0) * DEG;
    m.scale.setScalar(cfg.scale || 1);
    scene.add(m);
    couchSplat = m;
    if (portal.name) m.visible = false;
  } catch (err) {
    console.error("couch splat failed to load", err);
  }
}

/* ── portals: step INTO a photo, and back out to C306 ─────── */
function loadPortalWorld(name) {
  if (!portalWorlds[name]) {
    const sc = CONFIG.scenes?.[name];
    if (!sc) return Promise.reject(new Error(`no scene "${name}" in config.scenes`));
    const w = new World(scene);
    portalWorlds[name] = w.load(sc).then(async () => {
      w.model.visible = false;
      prepareMinimap(w);
      await prepareChaser(sc);
      return w;
    });
    portalWorlds[name].catch(() => delete portalWorlds[name]);
  }
  return portalWorlds[name];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const veil = $("#portalVeil");

async function goThrough(name) {
  if (portal.busy || portal.name) return;
  portal.busy = true;
  veil.classList.add("in"); // the photo fills her view and turns to light
  navigator.vibrate?.([20, 30, 20, 30, 60]);
  try {
    const [w] = await Promise.all([loadPortalWorld(name), wait(700)]);
    portal.saved = { x: state.player.x, z: state.player.z, heading: look.heading() };
    portal.name = name;
    room.focused = null;
    swapWorld(w, CONFIG.scenes[name]);
    song.pause(0.5); // the birthday song steps aside…
    musicFor(name).start(1.5); // …and the street's suspense music fades in
    $("#replayBtn").hidden = true;
    room.root.visible = false;
    if (couchSplat) couchSplat.visible = false;
    trail.mesh.visible = false;
    const s = w.nearestWalkable(here.start[0], here.start[2]);
    state.player.x = s.x;
    state.player.z = s.z;
    look.alignTo((here.startHeading || 0) * DEG);
    look.update(true);
    $("#backBtn").hidden = false;
    $("#roomHint").classList.remove("show");
    startChase(here); // …and something starts coming up the street
    setTimeout(() => toast(ui.portalIn, 3000), 500);
  } catch (err) {
    console.error(err);
    toast("That memory couldn't open 🙈", 2500);
  }
  veil.classList.remove("in");
  portal.busy = false;
}

async function goBack() {
  if (portal.busy || !portal.name) return;
  portal.busy = true;
  veil.classList.add("in");
  await wait(600);
  stopChase(here, 0.6);
  musicFor(portal.name).stop(0.6);
  song.resume(1.0); // the birthday song comes back where it left off
  $("#replayBtn").hidden = false;
  swapWorld(homeWorld, SC);
  room.root.visible = true;
  if (couchSplat) couchSplat.visible = true;
  trail.mesh.visible = true;
  const { x, z, heading } = portal.saved;
  state.player.x = x;
  state.player.z = z;
  look.alignTo(heading);
  look.update(true);
  portal.name = null;
  $("#backBtn").hidden = true;
  veil.classList.remove("in");
  portal.busy = false;
}

/* ── caught: jumpscare, then the whole thing "crashes" ────── */
async function crash() {
  if (state.crashed) return;
  state.crashed = true;
  const ch = here._chaser;
  ch.active = false;
  const js = $("#jumpscare");
  js.querySelector("img").src = ch.jumpscareUrl || ch.imageUrl; // the scare photo, not the chasing face
  js.hidden = false;
  navigator.vibrate?.([400, 60, 600]);
  if (sceneName()) musicFor(sceneName()).stop(0.05);
  ch.voice?.stop(0.02); // its voice cuts out as it gets you
  ch.voice?.stop(0.02);
  const len = playCrash(song);
  await wait(len * 1000);
  renderer.setAnimationLoop(null); // everything freezes…
  js.hidden = true;
  $("#crashScreen").hidden = false; // …and dies
}

// tap the crash screen to "reboot": back to C306 with the birthday song
$("#crashScreen").addEventListener("click", async () => {
  $("#crashScreen").hidden = true;
  state.crashed = false;
  if (!portal.name) return location.reload(); // the street opened on its own: just start over
  last = performance.now();
  renderer.setAnimationLoop(loop);
  await goBack();
});

function swapWorld(next, sc) {
  if (reality) world.setGhost(false);
  world.model.visible = false;
  world = next;
  world.model.visible = true;
  if (reality) world.setGhost(true);
  here = sc;
  state.stepQueue = 0;
  applyLook();
}
$("#backBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  goBack();
});
$("#roomHint").textContent = ui.roomHint;
$("#backBtn").textContent = ui.portalBack;
$("#replayBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  song.play();
  lyricIndex = -2;
});

/* ── movement ─────────────────────────────────────────────── */
const _fwd = new THREE.Vector3();
function move(dt) {
  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
  _fwd.normalize();
  const rx = -_fwd.z, rz = _fwd.x; // right vector

  let ix = joy.x + keys.x, iy = joy.y + keys.y;
  const im = Math.hypot(ix, iy);
  if (im > 1) { ix /= im; iy /= im; }
  const sp = CONFIG.walk.speed * (keys.has("shift") ? 2 : 1);
  let dx = (_fwd.x * iy + rx * ix) * sp * dt;
  let dz = (_fwd.z * iy + rz * ix) * sp * dt;

  // real steps: walk the queued distance at a natural pace
  if (state.stepQueue > 0) {
    const d = Math.min(state.stepQueue, 1.4 * dt);
    state.stepQueue -= d;
    dx += _fwd.x * d;
    dz += _fwd.z * d;
  }

  const before = { x: state.player.x, z: state.player.z };
  world.move(state.player, dx, dz);
  const moved = Math.hypot(state.player.x - before.x, state.player.z - before.z);
  if (moved < 0.0005 && state.stepQueue > 0 && (dx || dz)) state.stepQueue = 0; // walked into a wall
  state.bob += moved * 7.5;
  camera.position.set(state.player.x, here.eyeHeight + Math.sin(state.bob) * 0.025, state.player.z);
}

/* ── minimap ──────────────────────────────────────────────── */
function prepareMinimap(w) {
  const { width, height } = w.meta;
  const tint = document.createElement("canvas");
  tint.width = width;
  tint.height = height;
  const g = tint.getContext("2d");
  const data = g.createImageData(width, height);
  for (let i = 0; i < w.grid.length; i++) {
    if (!w.grid[i]) continue;
    data.data.set([255, 230, 245, 120], i * 4);
  }
  g.putImageData(data, 0, 0);
  w.mapTint = tint;
}
function drawMinimap() {
  const c = $("#minimap");
  const g = c.getContext("2d");
  const S = c.width, { originX, originZ, cell } = world.meta;
  const scale = 1.25; // canvas px per walkmap cell → ~9.6 m across
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.clip();
  g.translate(S / 2, S / 2);
  g.rotate(look.heading());
  g.scale(scale, scale);
  const toMap = (x, z) => [(x - originX) / cell, (z - originZ) / cell];
  const [px, pz] = toMap(state.player.x, state.player.z);
  g.translate(-px, -pz);
  g.imageSmoothingEnabled = true;
  g.drawImage(world.mapTint, 0, 0);
  const dot = (x, z, r, color) => {
    const [mx, mz] = toMap(x, z);
    g.beginPath();
    g.arc(mx, mz, r / scale, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };
  if (state.phase !== "room" && SC.room && !portal.name) {
    const t = SC.room.trigger;
    const pulse = 9 + Math.sin(performance.now() / 300) * 2;
    dot(t[0], t[2], pulse, state.collected === clues.length ? "rgba(6,214,160,0.9)" : "rgba(6,214,160,0.35)");
  }
  if (!portal.name) clues.forEach((cl) => !cl.collected && dot(cl.def.position[0], cl.def.position[2], 8, cl.def.color || "#ffd166"));
  g.restore();
  // her arrow, always pointing up
  g.save();
  g.translate(S / 2, S / 2);
  g.beginPath();
  g.moveTo(0, -16);
  g.lineTo(11, 12);
  g.lineTo(0, 6);
  g.lineTo(-11, 12);
  g.closePath();
  g.fillStyle = "#fff";
  g.shadowColor = "rgba(255,93,143,0.9)";
  g.shadowBlur = 10;
  g.fill();
  g.restore();
}

/* ── lyrics ───────────────────────────────────────────────── */
let lyricIndex = -2;
function updateLyrics() {
  const el = $("#lyrics");
  let idx = -1;
  if (song.playing) CONFIG.lyrics.forEach((l, k) => { if (song.time >= l.at) idx = k; });
  if (idx === lyricIndex) return;
  lyricIndex = idx;
  el.classList.add("swap");
  setTimeout(() => {
    el.textContent = idx >= 0 ? CONFIG.lyrics[idx].text.replace("{name}", CONFIG.name) : "";
    el.classList.remove("swap");
  }, 250);
}

/* ── loop ─────────────────────────────────────────────────── */
let last = performance.now(), frame = 0;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame++;

  look.update();
  if (!state.crashed) move(dt);
  camera.updateMatrixWorld();
  const chaser = here._chaser;
  if (chaser?.active) {
    const caught = chaser.update(now, dt, state.player);
    const k = chaser.closeness(state.player);
    if (sceneName()) musicFor(sceneName()).setIntensity(k, !chaser.voice); // its own voice replaces the synth whine
    if (chaser.voice) {
      // louder the closer it gets (barely there far away, full blast when it touches her)…
      const vol = 0.03 + 1.1 * Math.pow(k, 2);
      // …and coming from its side: left/right relative to where she's looking
      _rel.copy(chaser.group.position).applyMatrix4(camera.matrixWorldInverse);
      chaser.voice.set(vol, (_rel.x / Math.max(0.5, Math.hypot(_rel.x, _rel.z))) * 0.85);
    }
    if (caught) crash();
  }
  clues.forEach((c) => c.update(now, dt, camera));
  checkGoals(now);
  trail.update(now, state.player);
  if (state.phase === "room") {
    if (!portal.name) room.update(now, dt);
    updateLyrics(); // the song keeps going inside the photo
  }
  if (frame % 2 === 0) drawMinimap();
  renderer.render(scene, camera);
}

/* ── misc ─────────────────────────────────────────────────── */
function toast(text, ms = 2500) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function showError(msg) {
  const e = $("#error");
  e.querySelector("p").textContent = msg;
  e.hidden = false;
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && song.ctx?.state === "suspended") song.ctx.resume();
});

// Debug: number keys teleport next to a clue / the room door
if (DEBUG) {
  addEventListener("keydown", (e) => {
    const spots = [...SC.clues.map((c) => c.position), SC.room?.trigger].filter(Boolean);
    const p = spots[+e.key - 1];
    if (!p || state.phase === "intro") return;
    const s = world.nearestWalkable(p[0] + 1.6, p[2] + 0.6);
    state.player.x = s.x;
    state.player.z = s.z;
  });
}
