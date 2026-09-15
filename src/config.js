/**
 * 全局常量与数值平衡配置。
 * 所有可调数值集中在此文件，方便调平衡而不用翻逻辑代码。
 * 本文件不依赖任何 DOM，可在 Node 里直接 import（供无头模拟测试使用）。
 */

// ---------- 世界尺寸（逻辑像素，渲染时整体缩放到屏幕） ----------
// 比例刻意做成 24:11 ≈ 2.18:1，贴近手机横屏的屏幕比例：
// 世界能几乎铺满屏幕，HUD 则浮在画面上下边缘（正好落在空白的边距行上）。
export const TILE = 40;
export const COLS = 24;
export const ROWS = 11;
export const WORLD_W = COLS * TILE; // 960
export const WORLD_H = ROWS * TILE; // 440
// HUD 会遮住最上/最下各约 1 行，关卡设计时把道路限制在这些「安全行」之间
export const SAFE_ROW_MIN = 1;
export const SAFE_ROW_MAX = 9;

// ---------- 开局资源 ----------
export const START_GOLD = 180;
export const START_LIVES = 20;
export const MAX_LIVES = 99;

// ---------- 节奏 ----------
export const WAVE_BREAK = 5; // 波次之间的准备时间（秒）
export const FIRST_WAVE_DELAY = 12; // 开局给玩家布防的时间
export const EARLY_BONUS_GOLD = 4; // 提前召唤：每剩余 1 秒奖励的金币
export const SELL_RATIO = 0.7; // 出售返还比例（按累计投入计算）
export const MAX_TOWER_LEVEL = 3;
export const SPEEDS = [1, 2, 3];

// ---------- 逻辑帧 ----------
export const STEP = 1 / 60; // 固定步长，保证不同帧率下表现一致
export const MAX_STEPS_PER_FRAME = 12; // 单帧最多补算多少逻辑帧（防止切后台回来爆炸）

// ---------- 防御塔 ----------
/**
 * kind: 'physical' 受护甲减免 | 'magic' 无视护甲
 * growth: 每升一级的伤害倍率
 * projectile: null 表示瞬发（电塔用光束），否则走弹道
 */
export const TOWER_DEFS = {
  arrow: {
    key: 'arrow',
    name: '箭塔',
    short: '箭',
    desc: '射速快、单体伤害，性价比高，全能起手。',
    cost: 55,
    color: '#63d67a',
    colorDark: '#2f7a44',
    kind: 'physical',
    damage: 10,
    cooldown: 0.55,
    range: 118,
    growth: 1.85,
    projectile: 'arrow',
    projSpeed: 520
  },
  cannon: {
    key: 'cannon',
    name: '炮塔',
    short: '炮',
    desc: '慢速抛射，命中后范围爆炸，克制成群小怪。',
    cost: 90,
    color: '#f0913d',
    colorDark: '#8a4a15',
    kind: 'physical',
    damage: 32,
    cooldown: 1.4,
    range: 128,
    splash: 46,
    growth: 1.8,
    projectile: 'shell',
    projSpeed: 300
  },
  frost: {
    key: 'frost',
    name: '冰塔',
    short: '冰',
    desc: '伤害低但持续减速，为其它塔创造输出窗口。',
    cost: 75,
    color: '#5ec8ef',
    colorDark: '#1f6c8c',
    kind: 'magic',
    damage: 5,
    cooldown: 0.85,
    range: 108,
    slow: 0.4,
    slowDur: 1.6,
    growth: 1.7,
    projectile: 'shard',
    projSpeed: 420
  },
  tesla: {
    key: 'tesla',
    name: '电塔',
    short: '电',
    desc: '瞬发闪电，可在多个敌人间连锁，无视护甲。',
    cost: 140,
    color: '#b98cf0',
    colorDark: '#5b3c8c',
    kind: 'magic',
    damage: 17,
    cooldown: 1.15,
    range: 132,
    chain: 3,
    chainRange: 80,
    growth: 1.8,
    projectile: null
  },
  poison: {
    key: 'poison',
    name: '毒塔',
    short: '毒',
    desc: '附加持续掉血，无视护甲，专治高血量精英与首领。',
    cost: 100,
    color: '#a8c93a',
    colorDark: '#5a6e12',
    kind: 'magic',
    damage: 4,
    cooldown: 1.0,
    range: 122,
    dotDps: 11,
    dotDur: 4,
    growth: 1.75,
    projectile: 'glob',
    projSpeed: 340
  }
};

export const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'tesla', 'poison'];

/** 计算某座塔在某等级下的实际属性 */
export function towerStats(key, level) {
  const d = TOWER_DEFS[key];
  const p = level - 1;
  const s = {
    damage: d.damage * Math.pow(d.growth, p),
    range: d.range * (1 + 0.09 * p),
    cooldown: d.cooldown * Math.pow(0.9, p)
  };
  if (d.splash) s.splash = d.splash * (1 + 0.12 * p);
  if (d.chain) s.chain = d.chain + p;
  if (d.chainRange) s.chainRange = d.chainRange + 6 * p;
  if (d.slow) s.slow = Math.min(0.75, d.slow + 0.07 * p);
  if (d.slowDur) s.slowDur = d.slowDur + 0.3 * p;
  if (d.dotDps) {
    s.dotDps = d.dotDps * Math.pow(1.7, p);
    s.dotDur = d.dotDur;
  }
  s.dps = s.damage / s.cooldown;
  return s;
}

/** 从 level 升到 level+1 的花费 */
export function upgradeCost(key, level) {
  const d = TOWER_DEFS[key];
  return Math.round(d.cost * (level === 1 ? 0.9 : 1.65));
}

/** 累计投入（用于出售返还与战报统计） */
export function towerValue(key, level) {
  let v = TOWER_DEFS[key].cost;
  for (let l = 1; l < level; l++) v += upgradeCost(key, l);
  return v;
}

/** 该塔在当前等级下某条线的战力描述，用于面板展示 */
export function towerDpsText(key, level) {
  const s = towerStats(key, level);
  const d = TOWER_DEFS[key];
  if (d.dotDps) return `${s.dps.toFixed(0)} + 毒 ${s.dotDps.toFixed(0)}/s`;
  if (d.chain) return `${s.dps.toFixed(0)} × ${s.chain} 链`;
  if (d.splash) return `${s.dps.toFixed(0)} (范围)`;
  if (d.slow) return `${s.dps.toFixed(0)} (减速 ${Math.round(s.slow * 100)}%)`;
  return s.dps.toFixed(0);
}

// ---------- 敌人 ----------
export const ENEMY_DEFS = {
  grunt: {
    key: 'grunt',
    name: '小兵',
    hp: 62,
    speed: 54,
    reward: 8,
    armor: 0,
    radius: 11,
    leak: 1,
    color: '#e8595c',
    shape: 'circle'
  },
  runner: {
    key: 'runner',
    name: '疾行者',
    hp: 46,
    speed: 102,
    reward: 9,
    armor: 0,
    radius: 9,
    leak: 1,
    color: '#f2c53d',
    shape: 'dart'
  },
  swarm: {
    key: 'swarm',
    name: '虫群',
    hp: 28,
    speed: 78,
    reward: 4,
    armor: 0,
    radius: 8,
    leak: 1,
    color: '#f08c3a',
    shape: 'circle'
  },
  tank: {
    key: 'tank',
    name: '重甲',
    hp: 245,
    speed: 34,
    reward: 22,
    armor: 8,
    radius: 14,
    leak: 2,
    color: '#7d93a8',
    shape: 'hex'
  },
  flyer: {
    key: 'flyer',
    name: '飞行',
    hp: 80,
    speed: 84,
    reward: 13,
    armor: 0,
    radius: 10,
    leak: 1,
    color: '#c07df0',
    shape: 'diamond',
    flying: true
  },
  healer: {
    key: 'healer',
    name: '医官',
    hp: 135,
    speed: 46,
    reward: 18,
    armor: 2,
    radius: 12,
    leak: 1,
    color: '#7fe3b0',
    shape: 'cross',
    heal: 16,
    healRadius: 78,
    healCd: 2.2
  },
  boss: {
    key: 'boss',
    name: '首领',
    hp: 2300,
    speed: 30,
    reward: 190,
    armor: 14,
    radius: 22,
    leak: 3,
    color: '#c0392b',
    shape: 'boss',
    boss: true
  }
};

/** 随波次增长的血量倍率 */
export function enemyHpMul(levelHpMul, wave) {
  const w = Math.max(1, wave);
  return Math.pow(1 + 0.105 * (w - 1), 1.1) * levelHpMul;
}

/** 随波次微涨的移速倍率（不让后期怪过分漫长） */
export function enemySpeedMul(wave) {
  return 1 + 0.008 * (Math.max(1, wave) - 1);
}

/** 随波次微涨的击杀奖励 */
export function enemyRewardMul(wave) {
  return 1 + 0.04 * (Math.max(1, wave) - 1);
}

// ---------- 主题色 ----------
export const COLORS = {
  grassA: '#2c4a35',
  grassB: '#31523b',
  roadFill: '#6b5a45',
  roadEdge: '#4a3d2e',
  roadLine: '#8a7758',
  buildHover: 'rgba(120, 220, 150, 0.28)',
  buildBad: 'rgba(230, 90, 90, 0.30)',
  grid: 'rgba(255, 255, 255, 0.045)',
  gold: '#f5c542',
  life: '#ef5b6b',
  ui: '#e6edf3'
};
