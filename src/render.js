/**
 * 渲染层。分两层：
 *  1) 静态层：草地、道路、装饰物，只在进入关卡时画一次到离屏 canvas；
 *  2) 动态层：防御塔、敌人、弹道、特效，每帧画。
 */
import { COLS, ROWS, TILE, WORLD_W, WORLD_H, COLORS, TOWER_DEFS } from './config.js';
import { T_EMPTY } from './levels.js';
import { makeRng, clamp, easeOutCubic } from './utils.js';

const TAU = Math.PI * 2;

/** 计算把世界等比放进画布的黑边布局 */
export function computeView(cw, ch) {
  const scale = Math.min(cw / WORLD_W, ch / WORLD_H);
  return {
    scale,
    ox: (cw - WORLD_W * scale) / 2,
    oy: (ch - WORLD_H * scale) / 2
  };
}

export function screenToWorld(view, sx, sy) {
  return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
}

/**
 * 待机画面：还没进关卡（或关卡数据异常）时，往画布上画一张静态底图。
 * 画布是用 alpha:false 创建的，一次都不画就是纯黑一片 —— 一旦 HTML 弹窗因为任何
 * 原因没显示出来，玩家看到的就是"黑屏、什么都点不了"。所以这里主动把画布填上，
 * 保证"渲染管线是活的"这件事随时肉眼可见。
 */
export function drawIdle(ctx, dpr) {
  const cw = ctx.canvas.width / dpr;
  const ch = ctx.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#0b1119');
  bg.addColorStop(1, '#05070a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  // 淡淡的棋盘格，和关卡里的草地呼应
  const s = Math.max(24, Math.round(Math.min(cw, ch) / 14));
  ctx.fillStyle = 'rgba(255,255,255,0.014)';
  for (let y = 0, ry = 0; y < ch; y += s, ry++) {
    for (let x = 0, rx = 0; x < cw; x += s, rx++) {
      if ((rx + ry) % 2 === 0) ctx.fillRect(x, y, s, s);
    }
  }

  // 居中的塔徽 + 文案，明确告诉玩家"接下来去哪"
  const cx = cw / 2;
  const cy = ch / 2;
  const r = Math.max(18, Math.min(cw, ch) * 0.055);
  ctx.save();
  ctx.translate(cx, cy - 10);
  ctx.strokeStyle = 'rgba(99,214,122,0.45)';
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(99,214,122,0.3)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.36, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,237,243,0.7)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r * 0.72)}px system-ui, -apple-system, "PingFang SC", sans-serif`;
  ctx.fillText('平面塔防', 0, r * 2);
  ctx.fillStyle = 'rgba(147,161,176,0.8)';
  ctx.font = `${Math.round(r * 0.62)}px system-ui, -apple-system, "PingFang SC", sans-serif`;
  ctx.fillText('点右上角「开始」选关', 0, r * 2 + r * 0.9);
  ctx.restore();
}

// =====================================================================
// 静态层
// =====================================================================
export function buildStatic(level) {
  const SS = 2; // 超采样倍数，缩放后依然清晰
  const cv = document.createElement('canvas');
  cv.width = WORLD_W * SS;
  cv.height = WORLD_H * SS;
  const g = cv.getContext('2d');
  g.scale(SS, SS);
  const theme = level.theme;
  const rng = makeRng(level.def.seed ^ 0x9e3779b9);

  // 草地 / 沙地 / 岩地
  g.fillStyle = theme.bg1;
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((c + r) % 2 === 1) continue;
      g.fillStyle = theme.bg2;
      g.fillRect(c * TILE, r * TILE, TILE, TILE);
    }
  }
  // 噪声斑点，避免大片纯色显得廉价
  for (let i = 0; i < 900; i++) {
    const x = rng() * WORLD_W;
    const y = rng() * WORLD_H;
    const a = 0.03 + rng() * 0.05;
    g.fillStyle = rng() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const s = 1 + rng() * 3;
    g.fillRect(x, y, s, s);
  }

  // 网格
  g.strokeStyle = COLORS.grid;
  g.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    g.beginPath();
    g.moveTo(c * TILE, 0);
    g.lineTo(c * TILE, WORLD_H);
    g.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    g.beginPath();
    g.moveTo(0, r * TILE);
    g.lineTo(WORLD_W, r * TILE);
    g.stroke();
  }

  // 道路：三层描边（外沿 / 路面 / 中线）
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const strokeAll = (width, style) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const p of level.paths) {
      g.beginPath();
      g.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i++) g.lineTo(p.points[i].x, p.points[i].y);
      g.stroke();
    }
  };
  strokeAll(TILE * 0.98, theme.roadEdge);
  strokeAll(TILE * 0.84, theme.road);
  g.setLineDash([12, 14]);
  g.lineWidth = 2;
  g.strokeStyle = theme.roadLine;
  g.globalAlpha = 0.55;
  for (const p of level.paths) {
    g.beginPath();
    g.moveTo(p.points[0].x, p.points[0].y);
    for (let i = 1; i < p.points.length; i++) g.lineTo(p.points[i].x, p.points[i].y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.setLineDash([]);

  // 装饰物
  for (const d of level.decors) drawDecor(g, d, theme, rng);

  // 飞行航线：飞行单位会沿这条直线抄近路，必须让玩家看得见
  for (const p of level.airPaths) drawAirCorridor(g, p);

  // 出入口标记
  for (const p of level.paths) {
    const entry = entryPointOf(p);
    drawPortal(g, entry.x, entry.y);
  }
  drawCastle(g, level.goal.x, level.goal.y);

  return cv;
}

/** 空中航线：淡紫色虚线 + 云朵标记，提示玩家这里也会有敌人经过 */
function drawAirCorridor(g, path) {
  const a = path.points[0];
  const b = path.points[path.points.length - 1];
  const inView = (p) => p.x > 0 && p.x < WORLD_W && p.y > 0 && p.y < WORLD_H;
  let x0 = a.x;
  let y0 = a.y;
  let x1 = b.x;
  let y1 = b.y;
  // 把线截到画面内（出怪口在屏幕外）
  if (!inView({ x: x0, y: y0 })) {
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      if (py > 0 && py < WORLD_H) {
        x0 = px;
        y0 = py;
        break;
      }
    }
  }

  g.save();
  g.globalAlpha = 0.42;
  g.strokeStyle = '#c9a9ff';
  g.lineWidth = 2;
  g.setLineDash([5, 9]);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.setLineDash([]);

  // 沿线画几个小云团，让航线不显得像误触的杂线
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  g.globalAlpha = 0.5;
  const count = Math.max(2, Math.floor(len / 150));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.fillStyle = 'rgba(201,169,255,0.5)';
    g.beginPath();
    g.ellipse(0, 0, 11, 4.5, 0, 0, TAU);
    g.fill();
    g.restore();
  }
  g.restore();
}

function entryPointOf(path) {
  const p0 = path.points[0];
  const p1 = path.points[1];
  if (p0.x < 0) return { x: 4, y: p0.y, angle: 0 };
  if (p0.x > WORLD_W) return { x: WORLD_W - 4, y: p0.y, angle: Math.PI };
  if (p0.y < 0) return { x: p0.x, y: 4, angle: Math.PI / 2 };
  if (p0.y > WORLD_H) return { x: p0.x, y: WORLD_H - 4, angle: -Math.PI / 2 };
  return { x: p0.x, y: p0.y, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
}

function drawDecor(g, d, theme, rng) {
  const x = d.c * TILE + TILE / 2;
  const y = d.r * TILE + TILE / 2;
  const s = d.scale;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  // 影子
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.ellipse(0, 8, 11, 5, 0, 0, TAU);
  g.fill();
  switch (d.type) {
    case 'tree': {
      g.fillStyle = '#4a3826';
      g.fillRect(-2.5, -2, 5, 10);
      const tones = ['#2f6b3c', '#3a7f47', '#27592f'];
      for (let i = 0; i < 3; i++) {
        g.fillStyle = tones[(d.variant + i) % 3];
        g.beginPath();
        g.arc(-4 + i * 4, -8 + (i % 2) * 3, 9 - i, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'bush': {
      g.fillStyle = '#3d7a48';
      g.beginPath();
      g.arc(-6, 2, 7, 0, TAU);
      g.arc(5, 1, 8, 0, TAU);
      g.arc(0, -4, 7, 0, TAU);
      g.fill();
      break;
    }
    case 'rock': {
      g.fillStyle = '#6b6f75';
      g.beginPath();
      g.moveTo(-11, 8);
      g.lineTo(-6, -6);
      g.lineTo(3, -9);
      g.lineTo(11, 2);
      g.lineTo(8, 8);
      g.closePath();
      g.fill();
      g.fillStyle = '#878c93';
      g.beginPath();
      g.moveTo(-6, -6);
      g.lineTo(3, -9);
      g.lineTo(6, -1);
      g.lineTo(-3, 0);
      g.closePath();
      g.fill();
      break;
    }
    case 'cactus': {
      g.fillStyle = '#3f7a4a';
      g.fillRect(-4, -14, 8, 24);
      g.fillRect(-13, -6, 8, 6);
      g.fillRect(-13, -6, 5, 14);
      g.fillRect(5, -2, 8, 6);
      g.fillRect(9, -10, 5, 14);
      break;
    }
    case 'bone': {
      g.fillStyle = '#ddd6c2';
      g.beginPath();
      g.arc(-7, 0, 3.5, 0, TAU);
      g.arc(7, 0, 3.5, 0, TAU);
      g.fill();
      g.fillRect(-7, -2, 14, 4);
      break;
    }
    case 'lava': {
      g.fillStyle = 'rgba(255,120,40,0.9)';
      g.beginPath();
      g.ellipse(0, 2, 13, 9, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#ffd08a';
      g.beginPath();
      g.ellipse(-2, 1, 6, 4, 0, 0, TAU);
      g.fill();
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i % 2 ? '#9b7fd4' : '#c0a7f0';
        g.beginPath();
        const ox = (i - 1) * 7;
        const h = 8 + (i % 2) * 6;
        g.moveTo(ox, 8);
        g.lineTo(ox - 4, 8 - h);
        g.lineTo(ox, 8 - h - 6);
        g.lineTo(ox + 4, 8 - h);
        g.closePath();
        g.fill();
      }
      break;
    }
  }
  g.restore();
}

function drawPortal(g, x, y) {
  g.save();
  g.translate(x, y);
  const grad = g.createRadialGradient(0, 0, 2, 0, 0, 26);
  grad.addColorStop(0, 'rgba(255,90,90,0.85)');
  grad.addColorStop(0.6, 'rgba(180,40,60,0.35)');
  grad.addColorStop(1, 'rgba(180,40,60,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, 26, 0, TAU);
  g.fill();
  g.strokeStyle = '#ef5b6b';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 15, 0, TAU);
  g.stroke();
  g.restore();
}

function drawCastle(g, x, y) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.ellipse(0, 16, 22, 8, 0, 0, TAU);
  g.fill();
  // 城墙
  g.fillStyle = '#8d97a6';
  g.fillRect(-18, -12, 36, 28);
  g.fillStyle = '#a7b1c0';
  g.fillRect(-18, -12, 36, 6);
  // 城垛
  for (let i = -18; i < 18; i += 12) {
    g.fillStyle = '#8d97a6';
    g.fillRect(i, -20, 8, 9);
  }
  // 中央塔楼
  g.fillStyle = '#6f7a8a';
  g.fillRect(-7, -30, 14, 20);
  g.fillStyle = '#e05c5c';
  g.beginPath();
  g.moveTo(-10, -30);
  g.lineTo(0, -42);
  g.lineTo(10, -30);
  g.closePath();
  g.fill();
  // 门
  g.fillStyle = '#3b3229';
  g.beginPath();
  g.moveTo(-6, 16);
  g.lineTo(-6, 2);
  g.arc(0, 2, 6, Math.PI, 0);
  g.lineTo(6, 16);
  g.closePath();
  g.fill();
  // 旗子
  g.strokeStyle = '#d5dbe4';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -42);
  g.lineTo(0, -52);
  g.stroke();
  g.fillStyle = '#5ec8ef';
  g.beginPath();
  g.moveTo(0, -52);
  g.lineTo(11, -48);
  g.lineTo(0, -44);
  g.closePath();
  g.fill();
  g.restore();
}

// =====================================================================
// 动态层
// =====================================================================
export function draw(ctx, game, view, opts) {
  const { hover, buildKey, time } = opts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  let sx = 0;
  let sy = 0;
  if (game.shakeAmount > 0 && game.shakeTime > 0) {
    const k = game.shakeAmount * (game.shakeTime / 0.5);
    sx = (Math.random() - 0.5) * k * 2;
    sy = (Math.random() - 0.5) * k * 2;
  }
  const dpr = opts.dpr || 1;
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * (view.ox + sx), dpr * (view.oy + sy));

  // 静态层
  ctx.drawImage(opts.staticLayer, 0, 0, WORLD_W, WORLD_H);

  drawPathArrows(ctx, game, time);
  drawBuildHints(ctx, game, hover, buildKey);
  drawSelectedTowerRange(ctx, game, time);

  for (const t of game.towers) drawTower(ctx, t, time);
  for (const e of game.enemies) drawEnemy(ctx, e, time);
  for (const p of game.projectiles) drawProjectile(ctx, p);
  for (const f of game.effects) drawEffect(ctx, f);

  drawGhost(ctx, game, hover, buildKey, time);
}

/** 路面上的行进指示箭头，让玩家一眼看出怪从哪来 */
function drawPathArrows(ctx, game, time) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const spacing = 64;
  const shift = (time * 26) % spacing;
  for (const p of game.level.paths) {
    for (let d = shift; d < p.length; d += spacing) {
      const pt = p.pointAt(d);
      const a = p.angleAt(d);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-3, -6);
      ctx.lineTo(4, 0);
      ctx.lineTo(-3, 6);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** 选好塔型后，把可建/不可建的格子高亮出来 */
function drawBuildHints(ctx, game, hover, buildKey) {
  if (!buildKey) return;
  ctx.save();
  ctx.fillStyle = 'rgba(120, 220, 150, 0.10)';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (game.tileType(c, r) !== T_EMPTY) continue;
      if (game.towerAt(c, r)) continue;
      ctx.fillRect(c * TILE + 2, r * TILE + 2, TILE - 4, TILE - 4);
    }
  }
  ctx.restore();
}

function drawSelectedTowerRange(ctx, game, time) {
  const t = game.selectedTower;
  if (!t) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.range, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = TOWER_DEFS[t.key].color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(t.x, t.y, TILE / 2 - 2, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawGhost(ctx, game, hover, buildKey, time) {
  if (!buildKey || !hover) return;
  const def = TOWER_DEFS[buildKey];
  const ok = game.canBuildAt(hover.cx, hover.cy) && game.gold >= def.cost;
  const x = hover.cx * TILE + TILE / 2;
  const y = hover.cy * TILE + TILE / 2;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ok ? 'rgba(120, 220, 150, 0.35)' : 'rgba(230, 90, 90, 0.35)';
  ctx.fillRect(hover.cx * TILE + 2, hover.cy * TILE + 2, TILE - 4, TILE - 4);
  ctx.strokeStyle = ok ? '#8ef0a8' : '#f08a8a';
  ctx.lineWidth = 2;
  ctx.strokeRect(hover.cx * TILE + 2, hover.cy * TILE + 2, TILE - 4, TILE - 4);
  const fake = { key: buildKey, def, x, y, level: 1, angle: -Math.PI / 2, recoil: 0, pulse: time };
  drawTowerBody(ctx, fake, time);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ok ? 'rgba(160,240,180,0.5)' : 'rgba(240,140,140,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, def.range, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// -------------------------- 防御塔 --------------------------
function drawTower(ctx, t, time) {
  ctx.save();
  // 底座阴影
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(t.x, t.y + 5, 15, 7, 0, 0, TAU);
  ctx.fill();
  drawTowerBody(ctx, t, time);

  // 等级星标
  const n = t.level;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.55;
    const px = t.x + Math.cos(a) * 17;
    const py = t.y + Math.sin(a) * 10 + 10;
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.arc(px, py, 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawTowerBody(ctx, t, time) {
  const def = t.def || TOWER_DEFS[t.key];
  const x = t.x;
  const y = t.y;
  const pulse = (t.pulse || 0) % 2;
  ctx.save();
  ctx.translate(x, y);

  // 基座
  ctx.fillStyle = def.colorDark;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2b2f36';
  ctx.beginPath();
  ctx.arc(0, 0, 12.5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 12.5, 0, TAU);
  ctx.stroke();

  // 炮塔本体（随目标转向）
  ctx.rotate(t.angle || 0);
  const recoil = (t.recoil || 0) * 3;
  switch (def.key) {
    case 'arrow': {
      ctx.fillStyle = def.color;
      ctx.fillRect(-3 - recoil, -3.5, 17, 7);
      ctx.beginPath();
      ctx.moveTo(14 - recoil, 0);
      ctx.lineTo(6 - recoil, -6);
      ctx.lineTo(6 - recoil, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e8f7ec';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-8, -6);
      ctx.quadraticCurveTo(2, 0, -8, 6);
      ctx.stroke();
      break;
    }
    case 'cannon': {
      ctx.fillStyle = '#4a4f57';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.colorDark;
      ctx.fillRect(0 - recoil, -5, 20, 10);
      ctx.fillStyle = def.color;
      ctx.fillRect(16 - recoil, -6, 5, 12);
      break;
    }
    case 'frost': {
      ctx.fillStyle = def.color;
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i / 6) * TAU);
        ctx.fillRect(4, -1.6, 10, 3.2);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 5.5 + Math.sin(pulse * Math.PI * 2) * 0.8, 0, TAU);
      ctx.fill();
      break;
    }
    case 'tesla': {
      ctx.fillStyle = '#3b3350';
      ctx.fillRect(-4, -6, 8, 12);
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(-8, 0, 3, 0, TAU);
      ctx.arc(8, 0, 3, 0, TAU);
      ctx.fill();
      const glow = 4.5 + Math.sin(pulse * Math.PI * 2) * 1.4;
      ctx.fillStyle = '#efe3ff';
      ctx.beginPath();
      ctx.arc(0, 0, glow * 0.6, 0, TAU);
      ctx.fill();
      break;
    }
    case 'poison': {
      ctx.fillStyle = def.colorDark;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#d6f07a';
      ctx.beginPath();
      ctx.arc(3, -2 + Math.sin(pulse * Math.PI * 2) * 1.5, 1.6, 0, TAU);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// -------------------------- 敌人 --------------------------
function drawEnemy(ctx, e, time) {
  const d = e.def;
  const r = e.radius;
  const spawnScale = 1 - e.spawnAnim * 0.5;
  ctx.save();
  ctx.translate(e.x, e.y);

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75, r * 0.9, r * 0.4, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.scale(spawnScale, spawnScale);
  if (e.flying) {
    // 飞行单位上下浮动 + 翅膀
    ctx.translate(0, -6 + Math.sin(time * 6 + e.wobble) * 2);
    const flap = Math.sin(time * 16 + e.wobble) * 0.5;
    ctx.fillStyle = 'rgba(220,180,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-r, -2, r * 0.9, r * 0.4, flap, 0, TAU);
    ctx.ellipse(r, -2, r * 0.9, r * 0.4, -flap, 0, TAU);
    ctx.fill();
  }

  ctx.rotate(e.flying ? 0 : e.angle);
  ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : d.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;

  switch (d.shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(r * 0.35, -r * 0.25, r * 0.18, 0, TAU);
      ctx.arc(r * 0.35, r * 0.25, r * 0.18, 0, TAU);
      ctx.fill();
      break;
    case 'dart':
      ctx.beginPath();
      ctx.moveTo(r * 1.4, 0);
      ctx.lineTo(-r * 0.8, -r * 0.95);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.8, r * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'hex':
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-r * 0.6, -r * 0.15, r * 1.2, r * 0.3);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'cross':
      ctx.fillRect(-r * 0.42, -r, r * 0.84, r * 2);
      ctx.fillRect(-r, -r * 0.42, r * 2, r * 0.84);
      ctx.strokeRect(-r * 0.42, -r, r * 0.84, r * 2);
      ctx.strokeRect(-r, -r * 0.42, r * 2, r * 0.84);
      break;
    case 'boss':
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 尖刺王冠
      ctx.fillStyle = '#f3d27a';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.9 - 3, Math.sin(a) * r * 0.9);
        ctx.lineTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45);
        ctx.lineTo(Math.cos(a) * r * 0.9 + 3, Math.sin(a) * r * 0.9);
        ctx.closePath();
        ctx.fill();
      }
      break;
  }
  ctx.restore();

  // 状态环：减速 / 中毒
  if (e.slowed) {
    ctx.strokeStyle = 'rgba(120,220,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 3.5, 0, TAU);
    ctx.stroke();
  }
  if (e.poisoned) {
    ctx.strokeStyle = 'rgba(168,201,58,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, time * 2, time * 2 + Math.PI * 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // 血条
  if (e.hp < e.maxHp || d.boss) {
    const w = d.boss ? 54 : Math.max(20, r * 2.4);
    const h = d.boss ? 6 : 3.5;
    const bx = e.x - w / 2;
    const by = e.y - r - (e.flying ? 14 : 10);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    const hpFrac = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = hpFrac > 0.5 ? '#5ad469' : hpFrac > 0.22 ? '#f5c542' : '#ef5b6b';
    ctx.fillRect(bx, by, w * hpFrac, h);
  }
}

// -------------------------- 弹道 --------------------------
function drawProjectile(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  switch (p.type) {
    case 'arrow': {
      ctx.rotate(p.angle);
      ctx.strokeStyle = '#f2e6c9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(5, 0);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(3, -3.2);
      ctx.lineTo(3, 3.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'shell': {
      // 影子投在地面，制造抛物线错觉
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 12, 5, 2.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3a3f47';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f0913d';
      ctx.beginPath();
      ctx.arc(-1.5, -1.5, 2.5, 0, TAU);
      ctx.fill();
      break;
    }
    case 'shard': {
      ctx.rotate(p.angle);
      ctx.fillStyle = '#9fe4ff';
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(0, -3.5);
      ctx.lineTo(-6, 0);
      ctx.lineTo(0, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e6faff';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'glob': {
      ctx.fillStyle = '#a8c93a';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#d6f07a';
      ctx.beginPath();
      ctx.arc(-1.5, -1.5, 2, 0, TAU);
      ctx.fill();
      break;
    }
    default:
      ctx.fillStyle = p.color || '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fill();
  }
  ctx.restore();
}

// -------------------------- 特效 --------------------------
function drawEffect(ctx, f) {
  const p = f.p;
  switch (f.type) {
    case 'explosion': {
      ctx.save();
      const r = f.r * easeOutCubic(p);
      const grad = ctx.createRadialGradient(f.x, f.y, r * 0.2, f.x, f.y, r);
      grad.addColorStop(0, `rgba(255,240,190,${0.85 * (1 - p)})`);
      grad.addColorStop(0.5, `rgba(244,121,31,${0.6 * (1 - p)})`);
      grad.addColorStop(1, `rgba(120,40,10,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,200,120,${0.7 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * 0.92, 0, TAU);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'spark': {
      const x = f.x + (f.vx || 0) * f.t;
      const y = f.y + (f.vy || 0) * f.t + ((f.gravity || 0) * f.t * f.t) / 2;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = f.color;
      ctx.fillRect(x - f.size / 2, y - f.size / 2, f.size, f.size);
      ctx.globalAlpha = 1;
      break;
    }
    case 'frost': {
      ctx.strokeStyle = `rgba(158,228,255,${0.9 * (1 - p)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const r0 = f.r * 0.3;
        const r1 = f.r * (0.5 + p);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
        ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        ctx.stroke();
      }
      break;
    }
    case 'poisonSplash': {
      ctx.fillStyle = `rgba(168,201,58,${0.45 * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.4 + p), 0, TAU);
      ctx.fill();
      break;
    }
    case 'bubble': {
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#c7e37a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(f.x, f.y + f.vy * f.t, f.r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'deathPuff': {
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 0.5 * (1 - p);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1 + p * 1.2), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'heal': {
      ctx.strokeStyle = `rgba(127,227,176,${0.8 * (1 - p)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.3 + p * 0.8), 0, TAU);
      ctx.stroke();
      break;
    }
    case 'beam': {
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#e8d9ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      for (const pt of f.points) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(185,140,240,0.6)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'muzzle': {
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = f.color;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(10, 0);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      break;
    }
    case 'text': {
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `bold ${f.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const y = f.y + (f.vy || 0) * f.t;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
      ctx.globalAlpha = 1;
      break;
    }
    case 'leak': {
      ctx.strokeStyle = `rgba(239,91,107,${1 - p})`;
      ctx.lineWidth = 4 * (1 - p);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 12 + p * 40, 0, TAU);
      ctx.stroke();
      break;
    }
  }
}
