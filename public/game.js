const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const homeScreen = $('#homeScreen');
const multiplayerScreen = $('#multiplayerScreen');
const leaderboardScreen = $('#leaderboardScreen');
const raceScreen = $('#raceScreen');
const resultScreen = $('#resultScreen');

const drawCanvas = $('#drawCanvas');
const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
const raceCanvas = $('#raceCanvas');
const raceCtx = raceCanvas.getContext('2d');
const shareCanvas = $('#shareCanvas');
const shareCtx = shareCanvas.getContext('2d');

const state = {
  course: 'sprint',
  name: 'Barely a Horse',
  drawing: '',
  legLength: 100,
  opponentCount: 3,
  replay: [],
  sound: true,
  drawingTool: 'pen',
  brushSize: 7,
  race: null,
  result: null,
  leaderboardCourse: 'sprint',
  audio: null,
  multiplayer: null
};

const STORAGE_KEY = 'oddstride-save-v4';
const MAX_REPLAY_EVENTS = 1200;
const TARGET_TAP_MS = 145;
const MULTI_POLL_MS = 160;

function firebaseClient() {
  return window.oddstrideFirebase || null;
}
function firebaseConfigured() {
  return Boolean(firebaseClient()?.configured);
}
async function ensureFirebaseReady() {
  const fb = firebaseClient();
  if (!fb) throw new Error('Firebase client is still loading.');
  await fb.ready;
  return fb;
}
function updateFirebaseConfigUi(message = '') {
  const status = $('#firebaseConfigStatus');
  if (!status) return;
  if (!firebaseConfigured()) {
    status.textContent = message || 'Firebase is not configured yet. Add your Firebase Web App settings to public/firebase-config.js, then reload the page.';
    status.classList.remove('ok');
    return;
  }
  status.textContent = message || 'Firebase is configured. Anonymous sign-in and multiplayer rooms are ready.';
  status.classList.add('ok');
}

function show(screen) {
  [homeScreen, multiplayerScreen, leaderboardScreen, raceScreen, resultScreen].forEach((s) => s.classList.remove('active'));
  screen.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function formatTime(ms) { return `${(ms / 1000).toFixed(2)} s`; }
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][Math.min(n % 10, 3)]}`;
}
function courseName(course) { return course === 'sprint' ? '100 m Sprint' : '85 m Mixed Challenge'; }
function distanceForCourse(course) { return course === 'sprint' ? 100 : 85; }
function obstacleList(course) { return course === 'obstacles' ? [14, 27, 41, 55, 69] : []; }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
}

function updateSoundButton() {
  $('#soundBtn').textContent = `Sound: ${state.sound ? 'Sound on' : 'Sound off'}`;
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      name: state.name,
      legLength: state.legLength,
      sound: state.sound,
      drawing: state.drawing
    }));
  } catch {}
}

function clearDrawingCanvas() {
  drawCtx.save();
  drawCtx.globalCompositeOperation = 'source-over';
  drawCtx.fillStyle = '#fff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.restore();
}

function setupDrawingCanvas() {
  clearDrawingCanvas();
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  let drawing = false;
  let last = null;
  let pointerId = null;

  function pointFromEvent(e) {
    const r = drawCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(drawCanvas.width, (e.clientX - r.left) * (drawCanvas.width / r.width))),
      y: Math.max(0, Math.min(drawCanvas.height, (e.clientY - r.top) * (drawCanvas.height / r.height)))
    };
  }

  function begin(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drawing = true;
    pointerId = e.pointerId;
    last = pointFromEvent(e);
    drawCanvas.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    const p = pointFromEvent(e);
    drawCtx.save();
    if (state.drawingTool === 'eraser') {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.strokeStyle = 'rgba(0,0,0,1)';
      drawCtx.lineWidth = state.brushSize * 2.6;
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.strokeStyle = '#171717';
      drawCtx.lineWidth = state.brushSize;
    }
    drawCtx.beginPath();
    drawCtx.moveTo(last.x, last.y);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    drawCtx.restore();
    last = p;
  }

  function end(e) {
    if (!drawing || (e && e.pointerId !== pointerId)) return;
    drawing = false;
    last = null;
    pointerId = null;
    saveCurrentDrawing();
  }

  drawCanvas.addEventListener('pointerdown', begin);
  drawCanvas.addEventListener('pointermove', move);
  drawCanvas.addEventListener('pointerup', end);
  drawCanvas.addEventListener('pointercancel', end);
  drawCanvas.addEventListener('pointerleave', (e) => { if (e.buttons === 0) end(e); });
}

function saveCurrentDrawing() {
  state.drawing = exportTransparentDrawing();
  saveLocal();
}

function exportTransparentDrawing() {
  const source = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  const data = source.data;
  let minX = drawCanvas.width, minY = drawCanvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < drawCanvas.height; y++) {
    for (let x = 0; x < drawCanvas.width; x++) {
      const i = (y * drawCanvas.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const white = r > 238 && g > 238 && b > 238;
      if (white) {
        data[i + 3] = 0;
      } else if (a > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return '';

  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(drawCanvas.width - 1, maxX + pad); maxY = Math.min(drawCanvas.height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const trimmed = document.createElement('canvas');
  trimmed.width = w;
  trimmed.height = h;
  const tctx = trimmed.getContext('2d');
  tctx.putImageData(new ImageData(data, drawCanvas.width, drawCanvas.height), -minX, -minY);
  return trimmed.toDataURL('image/png');
}

function restoreDrawing(data) {
  const img = new Image();
  img.onload = () => {
    clearDrawingCanvas();
    const scale = Math.min(drawCanvas.width / img.width, drawCanvas.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    drawCtx.drawImage(img, (drawCanvas.width - w) / 2, (drawCanvas.height - h) / 2, w, h);
    state.drawing = data;
  };
  img.onerror = () => { state.drawing = ''; };
  img.src = data;
}

function clearDrawing() {
  clearDrawingCanvas();
  state.drawing = '';
  saveLocal();
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.name = String(saved.name || state.name).slice(0, 24);
    state.legLength = Number(saved.legLength) || 100;
    state.sound = saved.sound !== false;
    $('#nameInput').value = state.name;
    $('#legLength').value = String(state.legLength);
    $('#legLengthValue').textContent = `${state.legLength}%`;
    if (saved.drawing) restoreDrawing(saved.drawing);
  } catch {}
  updateSoundButton();
}

function setCourse(course) {
  state.course = course === 'obstacles' ? 'obstacles' : 'sprint';
  $$('.race-choice').forEach((el) => el.classList.toggle('active', el.dataset.course === state.course));
}

function ensureAudio() {
  if (!state.sound) return null;
  try {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === 'suspended') state.audio.resume();
    return state.audio;
  } catch { return null; }
}

function beep(freq, duration = 0.06, volume = 0.045) {
  const audio = ensureAudio();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  osc.connect(gain); gain.connect(audio.destination);
  osc.start(); osc.stop(audio.currentTime + duration);
}

function loadImage(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function makeRace() {
  const distance = distanceForCourse(state.course);
  const count = Math.max(1, Math.min(5, Number(state.opponentCount) || 3));
  const names = ['Dusty Boots', 'Fast-ish', 'Leg Day', 'Mango', 'Professor Hoof'];
  const racers = [{
    player: true, name: state.name, distance: 0, speed: 0, energy: 100, taps: [], x: 0, lane: 0, image: null, obstacleHits: new Set(), crossedAt: null
  }];
  for (let i = 0; i < count; i++) {
    racers.push({
      player: false, name: names[i], distance: 0, speed: 7.2 + Math.random() * 2.3, energy: 100, taps: [], x: 0, lane: i + 1, image: null, skill: 0.93 + Math.random() * 0.15, seed: Math.random() * 10000, crossedAt: null, obstacleHits: new Set()
    });
  }
  state.race = {
    type: 'single', distance, racers, startedAt: 0, elapsed: 0, active: false, countdown: 3, lastFrame: performance.now(), finished: false, obstacles: obstacleList(state.course)
  };
  state.replay = [];
}

async function prepareSingleImages() {
  const image = await loadImage(state.drawing);
  if (state.race?.racers[0]) state.race.racers[0].image = image;
}

async function startRace() {
  if (state.multiplayer) leaveRoom(false);
  state.name = ($('#nameInput').value.trim() || 'Unnamed Racer').slice(0, 24);
  state.legLength = Number($('#legLength').value) || 100;
  state.opponentCount = Number($('#opponentSelect').value) || 3;
  saveCurrentDrawing();
  if (!state.drawing) {
    state.drawing = makeFallbackDrawing();
    saveLocal();
  }
  makeRace();
  await prepareSingleImages();
  const race = state.race;
  configureRaceHud(false, race.distance);
  $('#countdown').textContent = '3';
  $('#countdown').style.display = 'block';
  $('#racePop').style.display = 'none';
  $('#giddyBtn').disabled = true;
  $('#keyHint').textContent = 'Tap repeatedly or press Space in a steady rhythm.';
  show(raceScreen);
  drawRace();
  race.lastFrame = performance.now();
  requestAnimationFrame(countdownTick);
}

function makeFallbackDrawing() {
  const c = document.createElement('canvas'); c.width = 180; c.height = 120;
  const x = c.getContext('2d'); x.strokeStyle = '#171717'; x.lineWidth = 7; x.lineCap = 'round';
  x.beginPath(); x.ellipse(75, 65, 48, 25, 0, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(128, 48, 15, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(48, 84); x.lineTo(40, 112); x.moveTo(93, 84); x.lineTo(102, 112); x.stroke();
  return c.toDataURL('image/png');
}

function configureRaceHud(multiplayer, distance) {
  $('#hudMode').textContent = multiplayer ? 'FRIENDS RACE' : 'COURSE';
  $('#hudCourse').textContent = courseName(multiplayer ? state.multiplayer.course : state.course);
  $('#multiplayerHudLabel').textContent = multiplayer ? `Room ${state.multiplayer.roomId}` : '';
  $('#distanceText').textContent = `0.0 / ${distance} m`;
  $('#progressBar').style.width = '0%';
  $('#paceBar').style.width = '0%';
}

function countdownTick(now) {
  const race = state.race;
  if (!race || race.type !== 'single') return;
  if (now - race.lastFrame >= 700) {
    race.lastFrame = now; race.countdown -= 1;
    if (race.countdown <= 0) {
      $('#countdown').textContent = 'GO!'; beep(820, 0.12, 0.07);
      window.setTimeout(() => {
        if (!state.race || state.race !== race) return;
        race.startedAt = performance.now(); race.lastFrame = race.startedAt; race.active = true;
        $('#countdown').style.display = 'none'; $('#giddyBtn').disabled = false; requestAnimationFrame(raceLoop);
      }, 380);
      return;
    }
    $('#countdown').textContent = String(race.countdown); beep(500 + race.countdown * 55, 0.05);
  }
  requestAnimationFrame(countdownTick);
}

function playerTapQuality(player, elapsed) {
  const lastTap = player.taps.length ? player.taps[player.taps.length - 1] : null;
  const interval = lastTap == null ? TARGET_TAP_MS : elapsed - lastTap;
  return { lastTap, interval, quality: lastTap == null ? 0.58 : Math.max(0, 1 - Math.abs(interval - TARGET_TAP_MS) / 185) };
}

function giddyUp() {
  if (state.multiplayer) return multiplayerTap();
  const race = state.race;
  if (!race?.active || race.finished) return;
  const now = performance.now();
  const player = race.racers[0];
  const elapsed = now - race.startedAt;
  const { quality } = playerTapQuality(player, elapsed);
  player.taps.push(elapsed);
  if (player.taps.length > MAX_REPLAY_EVENTS) player.taps.shift();
  state.replay.push(Math.round(elapsed));
  if (state.replay.length > MAX_REPLAY_EVENTS) state.replay.shift();
  player.energy = Math.max(0, player.energy - (0.7 + (1 - quality) * 1.5));
  player.speed = Math.min(14.6, player.speed + 1.25 * quality + 0.2);
  showPaceFeedback(quality);
  beep(260 + quality * 260, 0.035, 0.025);
}

function showPaceFeedback(quality) {
  const paceRacer = state.multiplayer ? state.race?.racers?.find((r) => r.player) : state.race?.racers?.[0];
  $('#paceBar').style.width = `${Math.round((paceRacer?.speed || 0) / 14.6 * 100)}%`;
  $('#racePop').textContent = quality > 0.8 ? 'GOOD RHYTHM' : quality > 0.55 ? 'KEEP GOING' : 'TOO EARLY / LATE';
  $('#racePop').style.display = 'block'; $('#racePop').style.opacity = quality > 0.55 ? '1' : '0.72';
  window.clearTimeout(showPaceFeedback._timer);
  showPaceFeedback._timer = window.setTimeout(() => { $('#racePop').style.display = 'none'; }, 240);
}

function recentTapCount(player, nowElapsed) {
  let count = 0;
  for (let i = player.taps.length - 1; i >= 0; i--) {
    if (nowElapsed - player.taps[i] <= 680) count++; else break;
  }
  return count;
}

function updatePlayer(dt) {
  const race = state.race, p = race.racers[0], nowElapsed = race.elapsed;
  const recent = recentTapCount(p, nowElapsed);
  const drag = recent === 0 ? 4.4 : 1.2;
  const fatigue = p.energy < 25 ? 1.8 : 0;
  p.speed = Math.max(0, p.speed - (drag + fatigue) * dt);
  p.distance += p.speed * dt;
  processObstacles(p, race);
}

function processObstacles(p, race) {
  for (const obstacle of race.obstacles) {
    if (p.distance >= obstacle && !p.obstacleHits.has(obstacle)) {
      p.obstacleHits.add(obstacle);
      const legRatio = state.legLength / 100;
      const rhythm = p.taps.length ? recentTapCount(p, race.elapsed) / 5 : 0;
      const clearance = 0.7 * legRatio + 0.1 * Math.min(1, rhythm);
      if (clearance < 0.82) {
        p.speed *= 0.62;
        $('#racePop').textContent = 'STUMBLED!'; $('#racePop').style.display = 'block'; $('#racePop').style.opacity = '1';
        window.clearTimeout(showPaceFeedback._timer);
        showPaceFeedback._timer = window.setTimeout(() => { $('#racePop').style.display = 'none'; }, 360);
        beep(120, 0.09, 0.035);
      } else beep(640, 0.035, 0.018);
    }
  }
}

function updateCpu(r, dt) {
  const t = (performance.now() + r.seed) / 1000;
  const target = 9.0 * r.skill + Math.sin(t * 1.17) * 0.55 + Math.sin(t * 0.63) * 0.3;
  r.speed += (target - r.speed) * Math.min(1, dt * 2.2);
  r.distance += Math.max(0, r.speed) * dt;
  if (state.race.obstacles.length) {
    for (const obstacle of state.race.obstacles) {
      if (r.distance >= obstacle && !r.obstacleHits.has(obstacle)) {
        r.obstacleHits.add(obstacle);
        const clearance = 0.84 + (r.skill - 1) * 0.6;
        if (clearance < 0.9) r.speed *= 0.76;
      }
    }
  }
}

function raceLoop(now) {
  const race = state.race;
  if (!race?.active || race.finished || race.type !== 'single') return;
  const dt = Math.min(0.05, Math.max(0, (now - race.lastFrame) / 1000));
  race.lastFrame = now; race.elapsed = now - race.startedAt;
  updatePlayer(dt); for (let i = 1; i < race.racers.length; i++) updateCpu(race.racers[i], dt);
  for (const r of race.racers) {
    if (r.distance >= race.distance && r.crossedAt == null) { r.distance = race.distance; r.crossedAt = race.elapsed; }
  }
  drawRace();
  const player = race.racers[0];
  $('#distanceText').textContent = `${Math.min(race.distance, player.distance).toFixed(1)} / ${race.distance} m`;
  $('#progressBar').style.width = `${Math.min(100, player.distance / race.distance * 100)}%`;
  $('#paceBar').style.width = `${Math.min(100, player.speed / 14.6 * 100)}%`;
  if (player.crossedAt != null) { finishSingleRace(); return; }
  requestAnimationFrame(raceLoop);
}

function finishSingleRace() {
  const race = state.race;
  if (!race || race.finished) return;
  race.finished = true; race.active = false; $('#giddyBtn').disabled = true;
  const player = race.racers[0];
  const timeMs = Math.max(1, Math.round(player.crossedAt));
  const position = race.racers.filter((r) => r !== player && r.crossedAt != null && r.crossedAt < player.crossedAt).length + 1;
  state.result = { timeMs, position, course: state.course, submitted: false, multiplayer: false };
  $('#racePop').textContent = `${ordinal(position)} PLACE`; $('#racePop').style.display = 'block'; beep(position === 1 ? 980 : 720, 0.2, 0.06);
  renderResult(); submitScore();
}

function drawTrack(ctx, width, height, distance, obstacles) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#dceee4'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#b9d7a6'; ctx.fillRect(0, height * 0.34, width, height * 0.18);
  for (let i = 0; i < 18; i++) { const x = (i / 17) * width; ctx.fillStyle = i % 2 ? '#94bb88' : '#a7c99a'; ctx.beginPath(); ctx.arc(x, height * 0.47 - (i % 2) * 5, 28, Math.PI, 0); ctx.fill(); }
  ctx.fillStyle = '#f7e9bd'; ctx.fillRect(0, height * 0.54, width, height * 0.46);
  ctx.fillStyle = '#cdbb91'; ctx.fillRect(0, height * 0.71, width, 8); ctx.fillRect(0, height * 0.89, width, 8);
  ctx.strokeStyle = '#c1ae80'; ctx.lineWidth = 2;
  for (let x = 0; x < width + 60; x += 58) { ctx.beginPath(); ctx.moveTo(x, height * 0.71); ctx.lineTo(x - 18, height); ctx.stroke(); }
  if (obstacles.length) {
    for (const d of obstacles) { const x = 80 + d / distance * (width - 160); ctx.fillStyle = '#c98f4a'; ctx.fillRect(x, height * 0.61, 34, height * 0.1); ctx.fillRect(x + 6, height * 0.71, 7, 46); ctx.fillRect(x + 21, height * 0.71, 7, 46); }
  }
}

function drawTransparentImage(ctx, image, x, y, scale, rotation = 0) {
  if (!image?.complete || !image.naturalWidth) return false;
  const maxW = 210 * scale, maxH = 125 * scale;
  const ratio = Math.min(maxW / image.width, maxH / image.height);
  const w = image.width * ratio, h = image.height * ratio;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.drawImage(image, -w / 2, -h * 0.72, w, h); ctx.restore();
  return true;
}

function drawFallbackHorse(ctx, x, y, scale, idx, body = '#171717') {
  ctx.save(); ctx.translate(x, y); ctx.translate(0, Math.sin(performance.now() / 85 + idx) * 3); ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, -16, 42 * scale, 28 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(38 * scale, -30 * scale, 16 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = body; ctx.lineWidth = 8 * scale;
  for (const leg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(leg * 18 * scale, 5); ctx.lineTo(leg * (24 + 5 * Math.sin(performance.now() / 80 + idx)) * scale, 52); ctx.stroke(); }
  ctx.restore();
}

function drawRaceRacer(ctx, r, x, y, scale, idx) {
  const bob = Math.sin(performance.now() / 72 + idx) * 3;
  if (!drawTransparentImage(ctx, r.image, x, y + bob, scale, Math.sin(performance.now() / 85 + idx) * 0.025)) {
    drawFallbackHorse(ctx, x, y, scale, idx, r.player ? '#171717' : (idx % 2 ? '#1e6b8e' : '#8f4c37'));
  }
}

function drawRace() {
  const race = state.race;
  if (!race) return;
  drawTrack(raceCtx, raceCanvas.width, raceCanvas.height, race.distance, race.obstacles || []);
  const laneHeight = Math.min(76, 240 / Math.max(1, race.racers.length));
  const startY = raceCanvas.height * 0.59;
  race.racers.forEach((r, idx) => {
    const y = startY + idx * laneHeight;
    const x = 88 + Math.min(race.distance, r.distance) / race.distance * (raceCanvas.width - 178);
    r.x = x; drawRaceRacer(raceCtx, r, x, y, race.racers.length > 4 ? 0.78 : 0.9, idx);
    raceCtx.fillStyle = '#171717'; raceCtx.font = '700 16px system-ui'; raceCtx.fillText(r.name, Math.max(10, x - 42), y - 64);
    raceCtx.strokeStyle = 'rgba(23,23,23,.10)'; raceCtx.lineWidth = 1; raceCtx.beginPath(); raceCtx.moveTo(60, y + 30); raceCtx.lineTo(raceCanvas.width - 55, y + 30); raceCtx.stroke();
  });
  const finishX = raceCanvas.width - 64; raceCtx.fillStyle = '#171717'; raceCtx.fillRect(finishX, raceCanvas.height * 0.48, 6, raceCanvas.height * 0.49);
  for (let y = raceCanvas.height * 0.48; y < raceCanvas.height * 0.97; y += 28) { raceCtx.fillStyle = Math.floor(y / 28) % 2 ? '#fff' : '#171717'; raceCtx.fillRect(finishX + 6, y, 24, 14); }
}

async function submitScore() {
  if (!state.result || state.result.submitted || state.result.multiplayer) return;
  try {
    const fb = await ensureFirebaseReady();
    const saved = await fb.saveScore({ name: state.name, course: state.course, timeMs: state.result.timeMs, drawing: state.drawing, replay: state.replay });
    const rows = await fb.loadScores(state.course);
    const rank = rows.findIndex((row) => Number(row.timeMs) > Number(saved.timeMs)) + 1;
    state.result.submitted = true;
    if (rank > 0) state.result.rank = rank;
    renderResult();
  } catch {
    $('#resultSubcopy').textContent = 'Your run finished locally. Firebase could not publish the score.';
  }
}

async function loadLeaderboard(course = state.leaderboardCourse) {
  state.leaderboardCourse = course;
  $('#leaderboardBody').innerHTML = '<div style="padding:18px;color:#6d6a64">Loading...</div>';
  try {
    const fb = await ensureFirebaseReady();
    const data = await fb.loadScores(course);
    if (!Array.isArray(data) || !data.length) {
      $('#leaderboardBody').innerHTML = '<div style="padding:18px;color:#6d6a64">No public times yet. Be the first.</div>';
      return;
    }
    $('#leaderboardBody').innerHTML = data.map((row, i) => `<div class="leader-row"><span class="rank">${i + 1}</span><span class="name">${escapeHtml(row.name)}</span><span class="time">${formatTime(Number(row.timeMs))}</span></div>`).join('');
  } catch {
    $('#leaderboardBody').innerHTML = '<div style="padding:18px;color:#6d6a64">Firebase is not configured or the database rules are blocking access.</div>';
  }
}

function resetMultiUi() {
  $('#multiplayerLobby').classList.add('hidden');
  $('#roomCodeDisplay').textContent = '----';
  $('#playerList').innerHTML = '';
  $('#lobbyStatus').textContent = 'Waiting for at least 2 players.';
  $('#startMultiplayerBtn').disabled = true;
  $('#startMultiplayerBtn').textContent = 'START RACE';
}

async function createRoom() {
  if (!firebaseConfigured()) {
    $('#firebaseConfigCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateFirebaseConfigUi('Set up Firebase first. Then reload this page and create the room again.');
    return;
  }
  state.name = ($('#nameInput').value.trim() || 'Unnamed Racer').slice(0, 24);
  state.legLength = Number($('#legLength').value) || 100;
  saveCurrentDrawing();
  if (!state.drawing) state.drawing = makeFallbackDrawing();
  try {
    const fb = await ensureFirebaseReady();
    const created = await fb.createRoom({ name: state.name, drawing: state.drawing, course: state.course, legLength: state.legLength });
    const room = created.room;
    state.multiplayer = { roomId: created.roomId, playerId: created.playerId, slot: 0, host: true, course: room.course, legLength: room.legLength, status: room.status, joinUrl: makeAppJoinUrl(created.roomId), polling: null, unsubscribe: null, serverOffset: room.serverNow - Date.now(), tapBusy: false, latestRoom: room };
    showLobby();
    startMultiplayerPolling();
  } catch (err) {
    $('#lobbyStatus').textContent = err.message || 'Could not create the room. Check your Firebase configuration and database rules.';
  }
}

async function joinRoom() {
  if (!firebaseConfigured()) {
    $('#firebaseConfigCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateFirebaseConfigUi('Set up Firebase first. Then reload this page and join the room again.');
    return;
  }
  state.name = ($('#nameInput').value.trim() || 'Unnamed Racer').slice(0, 24);
  saveCurrentDrawing();
  if (!state.drawing) state.drawing = makeFallbackDrawing();
  const roomId = ($('#joinCodeInput').value.trim() || '').toUpperCase();
  if (!roomId) { $('#lobbyStatus').textContent = 'Enter a room code first.'; return; }
  try {
    const fb = await ensureFirebaseReady();
    const joined = await fb.joinRoom({ roomId, name: state.name, drawing: state.drawing });
    const room = joined.room;
    const me = room.players.find((p) => p.id === joined.playerId);
    state.multiplayer = { roomId: joined.roomId, playerId: joined.playerId, slot: me?.slot ?? 1, host: joined.host, course: room.course, legLength: room.legLength, status: room.status, joinUrl: makeAppJoinUrl(joined.roomId), polling: null, unsubscribe: null, serverOffset: room.serverNow - Date.now(), tapBusy: false, latestRoom: room };
    setCourse(room.course);
    $('#legLength').value = String(room.legLength);
    $('#legLengthValue').textContent = `${room.legLength}%`;
    showLobby();
    startMultiplayerPolling();
  } catch (err) {
    $('#lobbyStatus').textContent = err.message || 'Could not join the room.';
  }
}

function showLobby() {
  const multi = state.multiplayer;
  $('#multiplayerLobby').classList.remove('hidden');
  $('#roomCodeDisplay').textContent = multi.roomId;
  $('#lobbyCourseText').textContent = `${courseName(multi.course)} • ${multi.legLength}% leg length • ${multi.host ? 'You are the host' : 'You joined as a racer'}`;
  $('#startMultiplayerBtn').style.display = multi.host ? '' : 'none';
  $('#hostStartCard').style.display = multi.host ? '' : 'none';
  $('#copyJoinUrlBtn').style.display = multi.joinUrl ? '' : 'none';
  $('#joinUrlText').textContent = multi.joinUrl || 'Use the room code to join this race.';
  $('#mobileRoomCode').textContent = multi.roomId;
  if (multi.joinUrl) {
    const qr = $('#roomQr');
    if (qr.dataset.url !== multi.joinUrl) { qr.src = makeQrUrl(multi.joinUrl); qr.dataset.url = multi.joinUrl; }
  }
}

function startMultiplayerPolling() {
  const multi = state.multiplayer;
  if (!multi) return;
  if (multi.unsubscribe) multi.unsubscribe();
  const fb = firebaseClient();
  if (!fb) { $('#lobbyStatus').textContent = 'Firebase is still loading. Reload the page if this stays here.'; return; }
  multi.unsubscribe = fb.watchRoom(multi.roomId, (room, err) => {
    if (!state.multiplayer || state.multiplayer.roomId !== multi.roomId) return;
    if (err) { $('#lobbyStatus').textContent = err.message || 'Room closed.'; return; }
    multi.serverOffset = room.serverNow - Date.now();
    multi.status = room.status;
    multi.course = room.course;
    multi.legLength = room.legLength;
    multi.latestRoom = room;
    if (room.status === 'waiting') renderLobby(room);
    if (room.status === 'racing') syncMultiplayerRace(room);
  });
}

function renderLobby(room) {
  if (!state.multiplayer) return;
  if (document.activeElement?.id === 'joinCodeInput') return;
  const multi = state.multiplayer;
  multi.joinUrl = makeAppJoinUrl(room.roomId);
  $('#roomCodeDisplay').textContent = room.roomId;
  $('#lobbyCourseText').textContent = `${courseName(room.course)} • ${room.legLength}% leg length • ${multi.host ? 'You are the host' : 'You joined as a racer'}`;
  $('#playerList').innerHTML = room.players.map((p) => `
    <div class="player-row ${p.id === multi.playerId ? 'you' : ''}">
      <span class="player-number">${p.slot + 1}</span>
      <div><strong>${escapeHtml(p.name)}</strong><small>${p.host ? 'HOST' : (p.id === multi.playerId ? 'YOU' : 'RACER')}</small></div>
      <span class="player-ready">READY</span>
    </div>`).join('');
  const enough = room.players.length >= 2;
  $('#startMultiplayerBtn').style.display = multi.host ? '' : 'none';
  $('#hostStartCard').style.display = multi.host ? '' : 'none';
  if (multi.host) {
    $('#startMultiplayerBtn').disabled = !enough;
    $('#startMultiplayerBtn').textContent = enough ? `START RACE (${room.players.length}/4)` : 'WAITING FOR PLAYERS';
    $('#hostStartHint').textContent = enough ? `${room.players.length} players connected. Press start when everyone is ready.` : 'Waiting for at least 2 players. Room capacity is 4.';
  }
  $('#lobbyStatus').textContent = enough ? `${room.players.length}/4 players are connected. The host controls the start.` : 'Share the QR code. The race needs at least 2 players.';
  $('#mobileRoomCode').textContent = room.roomId;
  if (multi.joinUrl) {
    $('#joinUrlText').textContent = multi.joinUrl;
    if ($('#roomQr').dataset.url !== multi.joinUrl) { $('#roomQr').src = makeQrUrl(multi.joinUrl); $('#roomQr').dataset.url = multi.joinUrl; }
  }
}

async function startMultiplayer() {
  const multi = state.multiplayer;
  if (!multi?.host) return;
  $('#startMultiplayerBtn').disabled = true;
  $('#startMultiplayerBtn').textContent = 'STARTING...';
  try {
    const fb = await ensureFirebaseReady();
    await fb.startRoom(multi.roomId, multi.playerId);
    $('#lobbyStatus').textContent = 'Race starting for everyone...';
  } catch (err) {
    $('#lobbyStatus').textContent = err.message || 'Could not start the race.';
    $('#startMultiplayerBtn').disabled = false;
    $('#startMultiplayerBtn').textContent = 'START RACE';
  }
}

async function multiplayerTap() {
  const multi = state.multiplayer, race = state.race;
  if (!multi || !race?.active || race.type !== 'multiplayer') return;
  const fb = firebaseClient();
  if (!fb) return;
  const tapAt = Math.round(fb.getServerNow() - race.startedAtServer);
  if (tapAt < 0 || tapAt > 30000) return;
  beep(420, 0.03, 0.02);
  showPaceFeedback(playerTapQuality(race.racers.find((r) => r.player) || { taps: [] }, tapAt).quality);
  try {
    await fb.sendTap(multi.roomId, multi.slot, tapAt);
  } catch {}
}

function simulateMultiPlayer(taps, elapsedMs, course, legLength) {
  const elapsed = Math.max(0, Math.min(Number(elapsedMs) || 0, 30000));
  const ordered = [...new Set((Array.isArray(taps) ? taps : []).map(Number).filter(Number.isFinite).map(Math.round))].sort((a,b) => a-b);
  const distanceTarget = distanceForCourse(course);
  const obstacles = obstacleList(course);
  let speed = 0;
  let energy = 100;
  let distance = 0;
  let tapIndex = 0;
  let previousTap = null;
  let lastObstacleIndex = -1;
  let finishTimeMs = null;
  const recent = [];
  const DT = 0.02;
  const TARGET = TARGET_TAP_MS;
  for (let t = 0; t <= elapsed + 0.0001; t += DT * 1000) {
    while (tapIndex < ordered.length && ordered[tapIndex] <= t + 0.0001) {
      const tap = ordered[tapIndex++];
      const interval = previousTap == null ? TARGET : tap - previousTap;
      const quality = previousTap == null ? 0.58 : Math.max(0, 1 - Math.abs(interval - TARGET) / 185);
      previousTap = tap;
      recent.push(tap);
      while (recent.length && tap - recent[0] > 680) recent.shift();
      energy = Math.max(0, energy - (0.7 + (1 - quality) * 1.5));
      speed = Math.min(14.6, speed + 1.25 * quality + 0.2);
    }
    while (recent.length && t - recent[0] > 680) recent.shift();
    const drag = recent.length === 0 ? 4.4 : 1.2;
    const fatigue = energy < 25 ? 1.8 : 0;
    speed = Math.max(0, speed - (drag + fatigue) * DT);
    distance += speed * DT;
    while (lastObstacleIndex + 1 < obstacles.length && distance >= obstacles[lastObstacleIndex + 1]) {
      lastObstacleIndex++;
      const legRatio = Number(legLength) / 100;
      const rhythm = Math.min(1, recent.length / 5);
      const clearance = 0.7 * legRatio + 0.1 * rhythm;
      if (clearance < 0.82) speed *= 0.62;
    }
    if (distance >= distanceTarget) { finishTimeMs = Math.round(t); distance = distanceTarget; break; }
  }
  return { distance, speed, energy, finishTimeMs };
}

function updateMultiRaceFromRoom(room) {
  const race = state.race;
  if (!race || race.type !== 'multiplayer') return;
  const fb = firebaseClient();
  const elapsed = Math.max(0, (fb?.getServerNow?.() ?? Date.now()) - race.startedAtServer);
  for (const r of race.racers) {
    const p = room.players.find((x) => x.id === r.id);
    if (!p) continue;
    r.name = p.name;
    r.taps = p.taps || [];
    const sim = simulateMultiPlayer(r.taps, elapsed, room.course, room.legLength);
    r.distance = sim.distance;
    r.speed = sim.speed;
    r.energy = sim.energy;
    r.crossedAt = sim.finishTimeMs;
  }
  const ranked = [...race.racers].sort((a,b) => {
    const af = a.crossedAt == null ? Infinity : a.crossedAt;
    const bf = b.crossedAt == null ? Infinity : b.crossedAt;
    if (af !== bf) return af - bf;
    if (a.crossedAt != null && b.crossedAt != null) return a.lane - b.lane;
    return b.distance - a.distance || a.lane - b.lane;
  });
  ranked.forEach((r, i) => { r.serverRank = i + 1; });
}

function updateMobileRaceUi(room) {
  const multi = state.multiplayer;
  if (!multi) return;
  $('#mobileRoomCode').textContent = room.roomId;
  const mine = state.race?.racers?.find((r) => r.id === multi.playerId);
  const distance = distanceForCourse(room.course);
  if (mine) {
    const place = mine.serverRank || room.players.length;
    $('#mobilePlace').textContent = `${place}/${room.players.length}`;
    $('#mobileDistanceText').textContent = `${Math.min(distance, mine.distance || 0).toFixed(1)} / ${distance} m`;
    $('#mobileProgressBar').style.width = `${Math.min(100, (mine.distance || 0) / distance * 100)}%`;
    const ownPlayer = room.players.find((p) => p.id === multi.playerId);
    if (ownPlayer?.drawing && $('#mobileHorseImage').getAttribute('src') !== ownPlayer.drawing) $('#mobileHorseImage').src = ownPlayer.drawing;
  }
  const sorted = [...(state.race?.racers || [])].sort((a,b) => (a.serverRank || 99) - (b.serverRank || 99));
  $('#mobileStandings').innerHTML = sorted.map((p) => {
    const mineClass = p.id === multi.playerId ? 'mine' : '';
    const t = p.crossedAt != null ? formatTime(p.crossedAt) : `${Math.min(99.9, (p.distance || 0) / distance * 99.9).toFixed(1)}m`;
    return `<div class="mobile-standing ${mineClass}"><span class="standing-pos">${p.serverRank || '-'}</span><span class="standing-name">${escapeHtml(p.name)}</span><span class="standing-time">${t}</span></div>`;
  }).join('');
}

async function buildMultiRace(room) {
  const racers = room.players.map((p) => ({ id: p.id, player: p.id === state.multiplayer.playerId, name: p.name, distance: 0, speed: 0, energy: 100, taps: p.taps || [], x: 0, lane: p.slot, image: null, crossedAt: null, serverRank: null }));
  state.race = { type: 'multiplayer', distance: distanceForCourse(room.course), racers, startedAtServer: room.startAt, active: false, finished: false, lastFrame: performance.now(), elapsed: 0, lastSimAt: -Infinity, obstacles: obstacleList(room.course) };
  await Promise.all(racers.map(async (r) => { const p = room.players.find((x) => x.id === r.id); r.image = await loadImage(p?.drawing || ''); }));
  updateMultiRaceFromRoom(room);
}

async function syncMultiplayerRace(room) {
  const multi = state.multiplayer;
  if (!multi) return;
  multi.latestRoom = room;
  multi.serverOffset = room.serverNow - Date.now();
  if (!state.race || state.race.type !== 'multiplayer') {
    state.course = room.course;
    state.legLength = room.legLength;
    await buildMultiRace(room);
    configureRaceHud(true, distanceForCourse(room.course));
    $('#keyHint').textContent = 'Your friends are racing too. Tap your own GIDDY UP! button.';
    $('#countdown').style.display = 'block';
    $('#countdown').textContent = '3';
    $('#giddyBtn').disabled = true;
    $('#mobileGiddyBtn').disabled = true;
    show(raceScreen);
    syncResponsiveMode();
    requestAnimationFrame(multiplayerRaceLoop);
  }
  updateMultiRaceFromRoom(room);
}

function multiplayerRaceLoop(now) {
  const race = state.race, multi = state.multiplayer;
  if (!race || !multi || race.type !== 'multiplayer') return;
  const fb = firebaseClient();
  const serverNow = fb?.getServerNow?.() ?? (Date.now() + (multi.serverOffset || 0));
  const untilStart = race.startedAtServer - serverNow;
  if (untilStart > 0) {
    const seconds = Math.ceil(untilStart / 1000);
    $('#countdown').style.display = 'block';
    $('#countdown').textContent = seconds <= 0 ? 'GO!' : String(Math.min(3, seconds));
    $('#giddyBtn').disabled = true;
    $('#mobileGiddyBtn').disabled = true;
    drawRace();
    requestAnimationFrame(multiplayerRaceLoop);
    return;
  }
  $('#countdown').style.display = 'none';
  $('#giddyBtn').disabled = false;
  $('#mobileGiddyBtn').disabled = false;
  race.active = true;
  const room = multi.latestRoom;
  const localRoom = room ? { ...room, serverNow } : null;
  race.elapsed = Math.max(0, serverNow - race.startedAtServer);
  if (localRoom && (!Number.isFinite(race.lastSimAt) || race.elapsed - race.lastSimAt >= 70)) {
    updateMultiRaceFromRoom(localRoom);
    updateMobileRaceUi(localRoom);
    race.lastSimAt = race.elapsed;
  }
  drawRace();
  const mine = race.racers.find((r) => r.player);
  if (mine) {
    $('#distanceText').textContent = `${Math.min(race.distance, mine.distance || 0).toFixed(1)} / ${race.distance} m`;
    $('#progressBar').style.width = `${Math.min(100, (mine.distance || 0) / race.distance * 100)}%`;
    $('#paceBar').style.width = `${Math.min(100, (mine.speed || 0) / 14.6 * 100)}%`;
    if (mine.crossedAt != null && !race.finished) finishMultiplayer(multi.latestRoom);
  }
  if (!race.finished) requestAnimationFrame(multiplayerRaceLoop);
}

function finishMultiplayer(room) {
  if (!state.multiplayer || !state.race || state.race.finished) return;
  state.race.finished = true;
  state.race.active = false;
  $('#giddyBtn').disabled = true;
  $('#mobileGiddyBtn').disabled = true;
  const mine = state.race.racers.find((p) => p.id === state.multiplayer.playerId);
  if (!mine || mine.crossedAt == null) return;
  state.name = mine.name;
  const player = room?.players?.find((p) => p.id === mine.id);
  state.drawing = player?.drawing || state.drawing;
  state.result = { timeMs: Math.max(1, Math.round(mine.crossedAt)), position: mine.serverRank || 4, course: room.course, multiplayer: true, roomId: room.roomId, submitted: true };
  renderResult();
}

async function leaveRoom(showHome = true) {
  const multi = state.multiplayer;
  if (!multi) return;
  try { if (multi.unsubscribe) multi.unsubscribe(); } catch {}
  try { const fb = await ensureFirebaseReady(); await fb.leaveRoom(multi.roomId, multi.slot, multi.host); } catch {}
  state.multiplayer = null;
  state.race = null;
  resetMultiUi();
  syncResponsiveMode();
  if (showHome) show(homeScreen);
}

function syncResponsiveMode() {
  document.body.classList.toggle('mobile-multiplayer', window.matchMedia('(max-width: 560px)').matches && !!state.multiplayer);
}

function openMultiplayerFromLink() {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!room) return;
  $('#joinCodeInput').value = room;
  resetMultiUi();
  show(multiplayerScreen);
  syncResponsiveMode();
  $('#lobbyStatus').textContent = `Ready to join room ${room}. Draw your horse, enter your name, then tap Join Room.`;
  window.history.replaceState({}, '', window.location.pathname);
}

function bindEvents() {
  $('#clearDrawingBtn').addEventListener('click', clearDrawing);
  $('#penTool').addEventListener('click', () => { state.drawingTool = 'pen'; $('#penTool').classList.add('active'); $('#eraserTool').classList.remove('active'); });
  $('#eraserTool').addEventListener('click', () => { state.drawingTool = 'eraser'; $('#eraserTool').classList.add('active'); $('#penTool').classList.remove('active'); });
  $('#brushSize').addEventListener('input', (e) => { state.brushSize = Number(e.target.value) || 7; });
  $('#nameInput').addEventListener('input', (e) => { state.name = e.target.value.slice(0, 24); saveLocal(); });
  $('#legLength').addEventListener('input', (e) => { state.legLength = Number(e.target.value) || 100; $('#legLengthValue').textContent = `${state.legLength}%`; saveLocal(); });
  $('#opponentSelect').addEventListener('change', (e) => { state.opponentCount = Number(e.target.value) || 3; });
  $$('.race-choice').forEach((el) => el.addEventListener('click', () => setCourse(el.dataset.course)));
  $('#startBtn').addEventListener('click', startRace);
  $('#multiplayerBtn').addEventListener('click', () => { resetMultiUi(); show(multiplayerScreen); syncResponsiveMode(); });
  $('#multiplayerBackBtn').addEventListener('click', () => { if (state.multiplayer) leaveRoom(); else show(homeScreen); });
  $('#createRoomBtn').addEventListener('click', createRoom);
  $('#joinRoomBtn').addEventListener('click', joinRoom);
  $('#joinCodeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#copyRoomBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.multiplayer?.roomId || ''); $('#copyRoomBtn').textContent = 'Copied'; setTimeout(() => $('#copyRoomBtn').textContent = 'Copy Code', 1000); } catch {} });
  $('#copyJoinUrlBtn').addEventListener('click', async () => { const url = state.multiplayer?.joinUrl || ''; if (!url) return; try { await navigator.clipboard.writeText(url); $('#copyJoinUrlBtn').textContent = 'Copied'; setTimeout(() => $('#copyJoinUrlBtn').textContent = 'Copy Phone Link', 1000); } catch {} });
  $('#startMultiplayerBtn').addEventListener('click', startMultiplayer);
  $('#leaveRoomBtn').addEventListener('click', () => leaveRoom());
  $('#leaderboardBtn').addEventListener('click', () => { show(leaderboardScreen); loadLeaderboard('sprint'); });
  $('#leaderboardBackBtn').addEventListener('click', () => show(homeScreen));
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => { $$('.tab').forEach((t) => t.classList.toggle('active', t === tab)); loadLeaderboard(tab.dataset.courseTab); }));
  $('#raceExitBtn').addEventListener('click', () => { if (state.multiplayer) leaveRoom(); else { state.race = null; show(homeScreen); } });
  $('#giddyBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); giddyUp(); });
  $('#mobileGiddyBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); giddyUp(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && raceScreen.classList.contains('active')) { e.preventDefault(); giddyUp(); } });
  $('#againBtn').addEventListener('click', () => { if (state.result?.multiplayer) { leaveRoom(); } else startRace(); });
  $('#newRacerBtn').addEventListener('click', () => { state.race = null; clearDrawing(); $('#nameInput').value = ''; state.name = ''; saveLocal(); show(homeScreen); });
  $('#resultLeaderboardBtn').addEventListener('click', () => { show(leaderboardScreen); loadLeaderboard(state.course); });
  $('#saveImageBtn').addEventListener('click', () => { const a = document.createElement('a'); a.download = `${state.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'racer'}-result.png`; a.href = shareCanvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); });
  $('#soundBtn').addEventListener('click', () => { state.sound = !state.sound; updateSoundButton(); saveLocal(); if (state.sound) beep(660, 0.06); });
  $('#brandButton').addEventListener('click', () => { if (state.multiplayer) leaveRoom(); else { state.race = null; show(homeScreen); } });
  $('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
  $('#helpClose').addEventListener('click', () => $('#helpDialog').close());
  $('#helpDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  window.addEventListener('resize', syncResponsiveMode);
  syncResponsiveMode();
  updateFirebaseConfigUi();
}

setupDrawingCanvas();
bindEvents();
loadSaved();
openMultiplayerFromLink();
window.setTimeout(() => updateFirebaseConfigUi(), 250);
window.setInterval(() => updateFirebaseConfigUi(), 2000);

