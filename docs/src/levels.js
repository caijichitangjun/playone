/**
 * 关卡数据：地形路径、装饰物、以及波次编排。
 * 路径用「格子坐标的路点」描述，必须横平竖直（保证路径格子易算、路面对齐）。
 * 本文件不依赖 DOM。
 */
import { COLS, ROWS, TILE, ENEMY_DEFS } from './config.js';
import { makeRng, randInt, pick } from './utils.js';

export const T_EMPTY = 0;
export const T_ROAD = 1;
export const T_BLOCK = 2;

export const THEMES = {
  plain: {
    name: '青草平原',
    bg1: '#2c4a35',
    bg2: '#33543d',
    road: '#6f5c46',
    roadEdge: '#463a2b',
    roadLine: '#8d7a5a',
    decors: ['tree', 'bush', 'rock']
  },
  desert: {
    name: '荒漠峡谷',
    bg1: '#5a4a2e',
    bg2: '#66542f',
    road: '#8a7048',
    roadEdge: '#5b482a',
    roadLine: '#a89163',
    decors: ['cactus', 'rock', 'bone']
  },
  volcano: {
    name: '熔岩要塞',
    bg1: '#3a2b30',
    bg2: '#452f33',
    road: '#5c4a45',
    roadEdge: '#33282a',
    roadLine: '#7d6660',
    decors: ['rock', 'lava', 'crystal']
  }
};

export const LEVELS = [
  {
    id: 1,
    name: '青草平原',
    desc: '新兵训练场。一条平缓的 S 形小路，适合熟悉五种防御塔的手感。',
    theme: 'plain',
    seed: 1337,
    hpMul: 0.95,
    gold: 210,
    lives: 20,
    waveCount: 12,
    decorCount: 18,
    waypoints: [
      [-1, 2], [4, 2], [4, 7], [9, 7], [9, 3],
      [14, 3], [14, 8], [19, 8], [19, 5], [23, 5]
    ]
  },
  {
    id: 2,
    name: '荒漠峡谷',
    desc: '双线进攻。两条路在右侧并成一条长走廊，合流段一座塔能同时打到两路，把火力堆在那里。',
    theme: 'desert',
    seed: 20240,
    hpMul: 1.25,
    gold: 300,
    lives: 20,
    waveCount: 16,
    decorCount: 22,
    // 两条路在右侧并成一条长走廊：合流段一塔打两路，是这关的设计核心
    waypoints: [
      [
        [-1, 1], [6, 1], [6, 4], [11, 4], [11, 2], [15, 2], [15, 4], [23, 4]
      ],
      [
        [-1, 8], [5, 8], [5, 5], [10, 5], [10, 7], [14, 7], [14, 4], [23, 4]
      ]
    ]
  },
  {
    id: 3,
    name: '熔岩要塞',
    desc: '长蛇阵 + 飞行抄近路。后期首领血量极高，毒塔与电塔的价值会体现出来。',
    theme: 'volcano',
    seed: 777,
    hpMul: 1.5,
    gold: 320,
    lives: 20,
    waveCount: 20,
    decorCount: 26,
    waypoints: [
      [
        [-1, 8], [2, 8], [2, 2], [6, 2], [6, 7], [10, 7],
        [10, 2], [14, 2], [14, 6], [18, 6], [18, 3], [21, 3], [21, 8], [23, 8]
      ]
    ]
  }
];

/** 一条行进路线：路点 + 累计长度，支持按里程取坐标 */
export class Path {
  constructor(tileWaypoints) {
    this.points = tileWaypoints.map(([c, r]) => ({
      x: c * TILE + TILE / 2,
      y: r * TILE + TILE / 2
    }));
    this.segments = [];
    this.cum = [0];
    let total = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.segments.push({ a, b, len, start: total });
      total += len;
      this.cum.push(total);
    }
    this.length = total;
    this.tileWaypoints = tileWaypoints;
  }

  /** 按里程取坐标（超出末端则停在终点） */
  pointAt(d, out = { x: 0, y: 0 }) {
    if (d <= 0) {
      out.x = this.points[0].x;
      out.y = this.points[0].y;
      return out;
    }
    if (d >= this.length) {
      const p = this.points[this.points.length - 1];
      out.x = p.x;
      out.y = p.y;
      return out;
    }
    // 线段数很少，线性扫描足够快
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (d <= s.start + s.len) {
        const t = (d - s.start) / s.len;
        out.x = s.a.x + (s.b.x - s.a.x) * t;
        out.y = s.a.y + (s.b.y - s.a.y) * t;
        return out;
      }
    }
    return out;
  }

  angleAt(d) {
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (d <= s.start + s.len) return Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    }
    const s = this.segments[this.segments.length - 1];
    return Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  }
}

function markRoadTiles(grid, a, b) {
  const [c1, r1] = a;
  const [c2, r2] = b;
  const dc = Math.sign(c2 - c1);
  const dr = Math.sign(r2 - r1);
  let c = c1;
  let r = r1;
  for (let guard = 0; guard < 200; guard++) {
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r * COLS + c] = T_ROAD;
    if (c === c2 && r === r2) break;
    if (c !== c2) c += dc;
    else if (r !== r2) r += dr;
  }
}

/** 判断某格是否是路 / 紧邻路 */
function isRoad(grid, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  return grid[r * COLS + c] === T_ROAD;
}

function nearRoad(grid, c, r) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (isRoad(grid, c + dc, r + dr)) return true;
    }
  }
  return false;
}

/**
 * 把关卡定义编译成运行期数据：路径、占用格、装饰物、波次表。
 */
export function buildLevel(def) {
  const waypointSets = Array.isArray(def.waypoints[0][0]) ? def.waypoints : [def.waypoints];
  const paths = waypointSets.map((wp) => new Path(wp));
  const airPaths = paths.map((p) => new Path([p.tileWaypoints[0], p.tileWaypoints[p.tileWaypoints.length - 1]]));

  const grid = new Uint8Array(COLS * ROWS);
  for (const wp of waypointSets) {
    for (let i = 0; i < wp.length - 1; i++) markRoadTiles(grid, wp[i], wp[i + 1]);
  }

  // 装饰物：选在离道路至少 1 格的空地上，避免挤占贴边的黄金建塔位
  const rng = makeRng(def.seed);
  const theme = THEMES[def.theme];
  const candidates = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r * COLS + c] !== T_EMPTY) continue;
      if (nearRoad(grid, c, r)) continue;
      candidates.push([c, r]);
    }
  }
  // Fisher-Yates（用确定性随机源）
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const decors = [];
  const want = Math.min(def.decorCount, candidates.length);
  for (let i = 0; i < want; i++) {
    const [c, r] = candidates[i];
    grid[r * COLS + c] = T_BLOCK;
    decors.push({
      c,
      r,
      type: pick(rng, theme.decors),
      variant: randInt(rng, 0, 3),
      scale: 0.8 + rng() * 0.45
    });
  }

  return {
    def,
    theme,
    grid,
    paths,
    airPaths,
    decors,
    waves: buildWaves(def),
    spawnPoints: paths.map((p) => ({ x: p.points[0].x, y: p.points[0].y })),
    goal: {
      x: paths[0].points[paths[0].points.length - 1].x,
      y: paths[0].points[0].y * 0 + paths[0].points[paths[0].points.length - 1].y
    }
  };
}

/**
 * 波次编排：前几波教学式递进，之后按规则叠加兵种，每 5 波出首领。
 * 返回 [[group,...], ...]，group = { type, count, gap, delay, lane }
 */
export function buildWaves(def) {
  const laneCount = Array.isArray(def.waypoints[0][0]) ? def.waypoints.length : 1;
  const N = def.waveCount;
  const waves = [];

  for (let w = 1; w <= N; w++) {
    const groups = [];
    const isBoss = w % 5 === 0;
    const bigBoss = w % 10 === 0;
    let lane = (w - 1) % laneCount;
    const nextLane = () => {
      lane = (lane + 1) % laneCount;
      return lane;
    };

    // 小兵：全程存在的压力基线
    groups.push({
      type: 'grunt',
      count: 4 + Math.round(w * 0.85),
      gap: Math.max(0.26, 0.8 - w * 0.022),
      delay: 0,
      lane: nextLane()
    });

    // 疾行者：第 2 波起，考验单体火力
    if (w >= 2) {
      groups.push({
        type: 'runner',
        count: 2 + Math.round(w * 0.5),
        gap: Math.max(0.22, 0.45 - w * 0.008),
        delay: 1.6,
        lane: nextLane()
      });
    }

    // 虫群：每 3 波来一次，考验范围伤害
    if (w >= 4 && w % 3 === 1) {
      groups.push({
        type: 'swarm',
        count: 10 + w,
        gap: 0.14,
        delay: 0.8,
        lane: nextLane()
      });
    }

    // 重甲：第 5 波起，护甲逼你上魔法伤害
    if (w >= 5) {
      groups.push({
        type: 'tank',
        count: 1 + Math.floor(w / 4),
        gap: 1.4,
        delay: 2.6,
        lane: nextLane()
      });
    }

    // 飞行：第 7 波起沿空中航线抄近路，数量比地面兵少但更难拦
    if (w >= 7 && w % 2 === 1) {
      groups.push({
        type: 'flyer',
        count: 2 + Math.floor(w / 4),
        gap: 0.8,
        delay: 3.4,
        lane: 0,
        flying: true
      });
    }

    // 医官：第 8 波起，拖延你的输出
    if (w >= 8 && w % 4 === 0) {
      groups.push({
        type: 'healer',
        count: 1 + Math.floor(w / 8),
        gap: 1.8,
        delay: 4.6,
        lane: nextLane()
      });
    }

    // 首领
    if (isBoss) {
      groups.push({
        type: 'boss',
        count: bigBoss ? 2 : 1,
        gap: 3.5,
        delay: 5.4,
        lane: nextLane()
      });
      if (bigBoss) {
        groups.push({
          type: 'tank',
          count: 3 + Math.floor(w / 5),
          gap: 1.2,
          delay: 7.5,
          lane: nextLane()
        });
      }
    }

    waves.push(groups);
  }
  return waves;
}

/** 该波会出现哪些兵种、各多少只（给玩家做预警提示） */
export function wavePreview(wave) {
  const agg = new Map();
  for (const g of wave) {
    const cur = agg.get(g.type) || { type: g.type, count: 0 };
    cur.count += g.count;
    agg.set(g.type, cur);
  }
  return [...agg.values()].map((g) => {
    const d = ENEMY_DEFS[g.type];
    return {
      type: g.type,
      name: d.name,
      count: g.count,
      color: d.color,
      boss: !!d.boss,
      flying: !!d.flying
    };
  });
}
