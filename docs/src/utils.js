/**
 * 通用工具：数学、随机数、本地存储、小工具。
 * 不依赖 DOM 的部分可安全用于无头测试。
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** 把角度差归一化到 [-PI, PI]，用于炮塔平滑转向 */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 确定性随机数（mulberry32），保证每次进同一关地形装饰一致 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, a, b) => a + rng() * (b - a);
export const randInt = (rng, a, b) => Math.floor(a + rng() * (b - a + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/** 原地压缩数组，移除 dead 元素，避免每帧产生新数组 */
export function compact(arr) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o.dead) arr[w++] = o;
  }
  arr.length = w;
}

export function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ---------- 本地存档 ----------
const KEY = 'plane-td-save-v1';

const memoryFallback = { data: null };

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return memoryFallback.data;
  }
}

function writeRaw(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    memoryFallback.data = obj; // 隐私模式等场景下降级为内存存档
  }
}

export const DEFAULT_SAVE = {
  unlocked: 1, // 已解锁关卡数
  best: {}, // { levelId: { wave, score } }
  sound: true,
  music: true,
  lastLevel: 1,
  rotateHintShown: false
};

export function loadSave() {
  const raw = readRaw();
  return Object.assign({}, DEFAULT_SAVE, raw || {}, { best: Object.assign({}, raw?.best || {}) });
}

export function saveSave(save) {
  writeRaw(save);
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    memoryFallback.data = null;
  }
}

/** 数字滚动之类的缓动 */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
