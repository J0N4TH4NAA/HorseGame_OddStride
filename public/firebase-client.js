import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onDisconnect,
  runTransaction,
  serverTimestamp,
  query,
  orderByChild,
  limitToFirst
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const cfg = window.ODDSTRIDE_FIREBASE_CONFIG || {};
const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
const configured = required.every((key) => String(cfg[key] || '').trim());

let app = null;
let auth = null;
let db = null;
let serverOffset = 0;
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

function snapshotToRoom(roomId, snap) {
  const raw = snap.val() || {};
  const rawPlayers = raw.players || {};
  const players = Object.entries(rawPlayers)
    .map(([slotKey, p]) => ({
      ...p,
      id: p?.uid || '',
      slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : Number(slotKey),
      host: p?.uid === raw.hostUid,
      distance: 0,
      speed: 0,
      energy: 100,
      finishTimeMs: null,
      position: null,
      taps: Object.values(p?.taps || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    }))
    .filter((p) => p.id)
    .sort((a, b) => a.slot - b.slot);
  return {
    roomId,
    serverNow: Date.now() + serverOffset,
    status: raw.status || 'waiting',
    hostPlayerId: raw.hostUid || '',
    course: raw.course === 'obstacles' ? 'obstacles' : 'sprint',
    legLength: Number(raw.legLength) || 100,
    startAt: Number(raw.startAt) || 0,
    raceDurationMs: null,
    players
  };
}

async function init() {
  if (!configured) throw new Error('Firebase is not configured yet. Edit public/firebase-config.js.');
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getDatabase(app);
  const offsetRef = ref(db, '.info/serverTimeOffset');
  onValue(offsetRef, (snap) => { serverOffset = Number(snap.val()) || 0; });
  await signInAnonymously(auth);
  readyResolve(true);
}

if (configured) init().catch((err) => readyReject(err));
else readyReject(new Error('Firebase is not configured yet. Edit public/firebase-config.js.'));

async function ensureReady() {
  await ready;
  if (!auth?.currentUser) throw new Error('Firebase sign-in is not ready.');
  return { db, uid: auth.currentUser.uid };
}

function cleanName(name) {
  return String(name || 'Unnamed Racer').trim().slice(0, 24) || 'Unnamed Racer';
}
function cleanDrawing(drawing) {
  return String(drawing || '').slice(0, 700000);
}
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function createRoom({ name, drawing, course, legLength }) {
  const { db, uid } = await ensureReady();
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = roomCode();
    const roomRef = ref(db, `rooms/${code}`);
    const roomData = {
      createdAt: Date.now(),
      status: 'waiting',
      hostUid: uid,
      course: course === 'obstacles' ? 'obstacles' : 'sprint',
      legLength: Math.max(60, Math.min(140, Number(legLength) || 100)),
      startAt: 0,
      players: {
        0: { uid, name: cleanName(name), drawing: cleanDrawing(drawing), slot: 0, ready: true, joinedAt: Date.now(), taps: {} }
      }
    };
    const result = await runTransaction(roomRef, (current) => current === null ? roomData : undefined, { applyLocally: false });
    if (result.committed) {
      await onDisconnect(roomRef.child('players/0')).remove();
      return { roomId: code, playerId: uid, host: true, room: snapshotToRoom(code, result.snapshot) };
    }
  }
  throw new Error('Could not create a unique room. Please try again.');
}

async function joinRoom({ roomId, name, drawing }) {
  const { db, uid } = await ensureReady();
  const code = String(roomId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error('Room codes are 4 characters.');
  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error('Room not found.');
  const current = snap.val();
  if (current.status !== 'waiting') throw new Error('Race already started.');
  const players = current.players || {};
  const slots = [1, 2, 3];
  for (const slot of slots) {
    const slotRef = ref(db, `rooms/${code}/players/${slot}`);
    const result = await runTransaction(slotRef, (existing) => {
      if (existing != null) return undefined;
      return { uid, name: cleanName(name), drawing: cleanDrawing(drawing), slot, ready: true, joinedAt: Date.now(), taps: {} };
    }, { applyLocally: false });
    if (result.committed && result.snapshot.val()?.uid === uid) {
      await onDisconnect(slotRef).remove();
      const fresh = await get(roomRef);
      return { roomId: code, playerId: uid, host: fresh.val()?.hostUid === uid, room: snapshotToRoom(code, fresh) };
    }
  }
  throw new Error(Object.keys(players).length >= 4 ? 'Room is full.' : 'Could not claim a player slot. Please try again.');
}

function watchRoom(roomId, callback) {
  const roomRef = ref(db, `rooms/${roomId}`);
  return onValue(roomRef, (snap) => {
    if (!snap.exists()) callback(null, new Error('Room closed.'));
    else callback(snapshotToRoom(roomId, snap), null);
  }, (err) => callback(null, err));
}

async function startRoom(roomId, playerId) {
  const { db, uid } = await ensureReady();
  if (uid !== playerId) throw new Error('Player identity changed.');
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error('Room not found.');
  const room = snap.val();
  if (room.hostUid !== uid) throw new Error('Only the host can start the race.');
  const count = Object.keys(room.players || {}).length;
  if (count < 2) throw new Error('At least 2 players are required.');
  await update(roomRef, {
    status: 'racing',
    startAt: serverTimestamp()
  });
}

async function sendTap(roomId, slot, tapAt) {
  const { db, uid } = await ensureReady();
  const playerRef = ref(db, `rooms/${roomId}/players/${slot}`);
  const playerSnap = await get(playerRef);
  if (!playerSnap.exists() || playerSnap.val()?.uid !== uid) throw new Error('You are not in this room.');
  const tapRef = push(ref(db, `rooms/${roomId}/players/${slot}/taps`));
  await set(tapRef, Math.max(0, Math.min(30000, Math.round(Number(tapAt) || 0))));
}

async function leaveRoom(roomId, slot, host) {
  const { db, uid } = await ensureReady();
  const roomRef = ref(db, `rooms/${roomId}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return;
  if (host && snap.val()?.hostUid === uid) {
    await remove(roomRef);
    return;
  }
  const playerRef = ref(db, `rooms/${roomId}/players/${slot}`);
  const p = await get(playerRef);
  if (p.exists() && p.val()?.uid === uid) await remove(playerRef);
}

async function saveScore({ name, course, timeMs, drawing, replay }) {
  const { db, uid } = await ensureReady();
  const cleanCourse = course === 'obstacles' ? 'obstacles' : 'sprint';
  const time = Math.round(Number(timeMs));
  if (!Number.isFinite(time) || time <= 1000 || time > 300000) throw new Error('Invalid time.');
  const scoreRef = push(ref(db, `scores/${cleanCourse}`));
  await set(scoreRef, {
    uid,
    name: cleanName(name),
    course: cleanCourse,
    timeMs: time,
    drawing: cleanDrawing(drawing),
    replay: Array.isArray(replay) ? replay.slice(0, 1200) : [],
    createdAt: serverTimestamp()
  });
  return { id: scoreRef.key, timeMs: time };
}

async function loadScores(course) {
  const { db } = await ensureReady();
  const q = query(ref(db, `scores/${course === 'obstacles' ? 'obstacles' : 'sprint'}`), orderByChild('timeMs'), limitToFirst(100));
  const snap = await get(q);
  if (!snap.exists()) return [];
  return Object.values(snap.val() || {}).sort((a, b) => Number(a.timeMs) - Number(b.timeMs));
}

window.oddstrideFirebase = {
  configured,
  ready,
  getServerNow: () => Date.now() + serverOffset,
  createRoom,
  joinRoom,
  watchRoom,
  startRoom,
  sendTap,
  leaveRoom,
  saveScore,
  loadScores
};
