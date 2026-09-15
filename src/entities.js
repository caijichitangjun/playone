/**
 * 实体：敌人、防御塔、弹道、特效。
 * 全部使用「构造一次 + init 复用」的写法，配合 game 里的 compact 原地压缩，
 * 避免战斗高峰期每帧产生大量垃圾对象。
 */
import {
  ENEMY_DEFS,
  TOWER_DEFS,
  towerStats,
  MAX_TOWER_LEVEL
} from './config.js';
import { clamp, angleDelta, dist2 } from './utils.js';

const TAU = Math.PI * 2;

// =====================================================================
// 敌人
// =====================================================================
export class Enemy {
  constructor() {
    this.dead = true;
  }

  init(defKey, path, opts) {
    const d = ENEMY_DEFS[defKey];
    this.def = d;
    this.key = defKey;
    this.path = path;
    this.flying = !!opts.flying || !!d.flying;

    this.maxHp = d.hp * opts.hpMul;
    this.hp = this.maxHp;
    this.baseSpeed = d.speed * opts.speedMul;
    this.reward = Math.round(d.reward * opts.rewardMul);
    this.armor = d.armor;

    this.dist = 0;
    this.progress = 0;
    this.radius = d.radius;
    this.laneOffset = opts.laneOffset || 0;
    this.wave = opts.wave;

    this.x = path.points[0].x;
    this.y = path.points[0].y;
    this.angle = 0;
    this.hitFlash = 0;
    this.slowFactor = 0;
    this.slowUntil = -1;
    this.poisonDps = 0;
    this.poisonUntil = -1;
    this.poisonTick = 0;
    this.healCd = d.healCd || 0;
    this.spawnAnim = 1;
    this.wobble = Math.random() * TAU;
    this.lastHitBy = null;
    this.dead = false;
    this._p = { x: 0, y: 0 };
    return this;
  }

  get alive() {
    return !this.dead && this.hp > 0;
  }

  /** 当前是否有减速状态 */
  get slowed() {
    return this.slowFactor > 0;
  }

  get poisoned() {
    return this.poisonDps > 0;
  }

  applySlow(factor, dur, time) {
    if (factor >= this.slowFactor) this.slowFactor = factor;
    this.slowUntil = Math.max(this.slowUntil, time + dur);
  }

  applyPoison(dps, dur, time) {
    this.poisonDps = Math.max(this.poisonDps, dps);
    this.poisonUntil = Math.max(this.poisonUntil, time + dur);
  }

  /** 返回实际造成的伤害 */
  takeDamage(amount, kind, time) {
    if (this.dead) return 0;
    const dmg = kind === 'physical' ? Math.max(1, amount - this.armor) : Math.max(1, amount);
    this.hp -= dmg;
    this.hitFlash = 0.12;
    if (this.hp <= 0) this.hp = 0;
    return dmg;
  }

  update(dt, game) {
    const time = game.time;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.slowUntil <= time) this.slowFactor = 0;
    if (this.poisonUntil <= time) {
      this.poisonDps = 0;
    } else if (this.poisonDps > 0) {
      // 毒伤按 0.25 秒一跳，避免每帧刷特效
      this.poisonTick -= dt;
      if (this.poisonTick <= 0) {
        this.poisonTick = 0.25;
        const before = this.hp;
        this.hp -= this.poisonDps * 0.25;
        game.stats.damage += Math.min(before, this.poisonDps * 0.25);
        if (game.rng() < 0.5) spawnPoisonBubble(game, this.x, this.y);
        if (this.hp <= 0) {
          this.hp = 0;
          game.killEnemy(this, true);
          return;
        }
      }
    }

    // 医官：周期性治疗周围同伴
    if (this.def.heal) {
      this.healCd -= dt;
      if (this.healCd <= 0) {
        this.healCd = this.def.healCd;
        let healed = 0;
        const r2 = this.def.healRadius * this.def.healRadius;
        for (const e of game.enemies) {
          if (e === this || e.dead || e.hp >= e.maxHp) continue;
          if (dist2(e.x, e.y, this.x, this.y) > r2) continue;
          e.hp = Math.min(e.maxHp, e.hp + this.def.heal);
          healed++;
        }
        if (healed > 0) spawnHealPulse(game, this.x, this.y, this.def.healRadius);
      }
    }

    // 位移
    const speed = this.baseSpeed * (1 - this.slowFactor);
    this.dist += speed * dt;
    const p = this.path.pointAt(this.dist, this._p);
    const a = this.path.angleAt(this.dist);
    this.angle = a;
    if (this.laneOffset) {
      // 垂直于行进方向做一点偏移，让成群敌人不至于完全重叠
      const nx = Math.cos(a + Math.PI / 2);
      const ny = Math.sin(a + Math.PI / 2);
      this.x = p.x + nx * this.laneOffset;
      this.y = p.y + ny * this.laneOffset;
    } else {
      this.x = p.x;
      this.y = p.y;
    }
    this.progress = this.dist / this.path.length;
    if (this.spawnAnim > 0) this.spawnAnim = Math.max(0, this.spawnAnim - dt * 2.5);

    if (this.dist >= this.path.length) game.leak(this);
  }
}

// =====================================================================
// 防御塔
// =====================================================================
export class Tower {
  constructor() {
    this.dead = true;
  }

  init(key, cx, cy) {
    this.key = key;
    this.def = TOWER_DEFS[key];
    this.cx = cx;
    this.cy = cy;
    this.x = cx * 40 + 20;
    this.y = cy * 40 + 20;
    this.level = 1;
    this.cooldown = 0;
    this.angle = -Math.PI / 2;
    this.targetMode = 'first';
    this.recoil = 0;
    this.pulse = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.shots = 0;
    this.dead = false;
    this._t = { x: 0, y: 0 };
    this.refresh();
    return this;
  }

  /** 等级变化后重算属性 */
  refresh() {
    const s = towerStats(this.key, this.level);
    this.stats = s;
    this.range = s.range;
    this.range2 = s.range * s.range;
  }

  get maxed() {
    return this.level >= MAX_TOWER_LEVEL;
  }

  update(dt, game) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 5);
    this.pulse = (this.pulse + dt) % 10;

    const target = this.acquire(game);
    this.targetRef = target;
    if (!target) return;

    const want = Math.atan2(target.y - this.y, target.x - this.x);
    const d = angleDelta(this.angle, want);
    // 转向速度有限，视觉上更像真的炮塔在瞄准
    const turn = Math.min(Math.abs(d), dt * 9) * Math.sign(d);
    this.angle += turn;

    if (this.cooldown <= 0) {
      this.fire(target, game);
      this.cooldown = this.stats.cooldown;
    }
  }

  /** 按当前优先级挑选目标 */
  acquire(game) {
    const list = game.enemies;
    let best = null;
    let bestScore = -Infinity;
    const mode = this.targetMode;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead || e.hp <= 0) continue;
      if (dist2(e.x, e.y, this.x, this.y) > this.range2) continue;
      let score;
      switch (mode) {
        case 'last':
          score = -e.progress;
          break;
        case 'strong':
          score = e.hp;
          break;
        case 'weak':
          score = -e.hp;
          break;
        case 'close':
          score = -dist2(e.x, e.y, this.x, this.y);
          break;
        default:
          score = e.progress;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  fire(target, game) {
    const s = this.stats;
    const def = this.def;
    this.shots++;
    this.recoil = 1;

    if (!def.projectile) {
      // 电塔：瞬发连锁闪电
      const hit = [];
      let cur = target;
      const chain = s.chain;
      for (let i = 0; i < chain && cur; i++) {
        hit.push(cur);
        const dmg = s.damage * Math.pow(0.78, i);
        game.damageEnemy(cur, dmg, 'magic', this);
        if (i < chain - 1) {
          let next = null;
          let bestD = s.chainRange * s.chainRange;
          for (const e of game.enemies) {
            if (e.dead || hit.includes(e)) continue;
            const dd = dist2(e.x, e.y, cur.x, cur.y);
            if (dd < bestD) {
              bestD = dd;
              next = e;
            }
          }
          cur = next;
        }
      }
      spawnBeam(game, this.x, this.y - 12, hit);
      game.sound.zap();
      return;
    }

    // 抛射类：按目标速度做一次提前量预测
    const px = predictLead(target, this.x, this.y, def.projSpeed);
    const ang = Math.atan2(px.y - this.y, px.x - this.x);
    const proj = game.obtainProjectile();
    proj.init({
      x: this.x + Math.cos(ang) * 14,
      y: this.y + Math.sin(ang) * 14 - 10,
      target,
      aimX: px.x,
      aimY: px.y,
      speed: def.projSpeed,
      damage: s.damage,
      kind: def.kind,
      splash: s.splash || 0,
      slow: s.slow || 0,
      slowDur: s.slowDur || 0,
      dotDps: s.dotDps || 0,
      dotDur: s.dotDur || 0,
      type: def.projectile,
      color: def.color,
      owner: this
    });
    game.projectiles.push(proj);
    game.sound.shoot(def.projectile);
  }
}

/** 预判目标未来位置（沿路径推进） */
function predictLead(target, fromX, fromY, projSpeed) {
  let t = Math.hypot(target.x - fromX, target.y - fromY) / projSpeed;
  for (let i = 0; i < 2; i++) {
    const d = Math.min(target.path.length, target.dist + target.baseSpeed * (1 - target.slowFactor) * t);
    const p = target.path.pointAt(d);
    t = Math.hypot(p.x - fromX, p.y - fromY) / projSpeed;
  }
  const d = Math.min(target.path.length, target.dist + target.baseSpeed * (1 - target.slowFactor) * t);
  return target.path.pointAt(d);
}

// =====================================================================
// 弹道
// =====================================================================
export class Projectile {
  constructor() {
    this.dead = true;
  }

  init(o) {
    this.x = o.x;
    this.y = o.y;
    this.startX = o.x;
    this.startY = o.y;
    this.target = o.target;
    this.aimX = o.aimX;
    this.aimY = o.aimY;
    this.speed = o.speed;
    this.damage = o.damage;
    this.kind = o.kind;
    this.splash = o.splash;
    this.slow = o.slow;
    this.slowDur = o.slowDur;
    this.dotDps = o.dotDps;
    this.dotDur = o.dotDur;
    this.type = o.type;
    this.color = o.color;
    this.owner = o.owner;
    this.t = 0;
    this.angle = Math.atan2(o.aimY - o.y, o.aimX - o.x);
    this.dead = false;
    return this;
  }

  update(dt, game) {
    this.t += dt;
    // 追踪：目标还活着就更新瞄准点
    if (this.target && !this.target.dead && this.target.hp > 0) {
      this.aimX = this.target.x;
      this.aimY = this.target.y;
    }
    const dx = this.aimX - this.x;
    const dy = this.aimY - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    this.angle = Math.atan2(dy, dx);

    if (d <= step + 2) {
      this.x = this.aimX;
      this.y = this.aimY;
      this.impact(game);
      this.dead = true;
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;

    // 超时保护，防止目标被打死后弹道无限飞行
    if (this.t > 3) this.dead = true;
  }

  impact(game) {
    const owner = this.owner;
    if (this.splash > 0) {
      const r2 = this.splash * this.splash;
      for (const e of game.enemies) {
        if (e.dead || e.hp <= 0) continue;
        const dd = dist2(e.x, e.y, this.x, this.y);
        if (dd > r2) continue;
        const falloff = 0.5 + 0.5 * (1 - Math.sqrt(dd) / this.splash);
        game.damageEnemy(e, this.damage * falloff, this.kind, owner);
        this.applyExtras(e, game);
      }
      spawnExplosion(game, this.x, this.y, this.splash);
      game.shake(4, 0.18);
      game.sound.explode();
    } else {
      const e = this.target && !this.target.dead && this.target.hp > 0 ? this.target : null;
      if (e) {
        game.damageEnemy(e, this.damage, this.kind, owner);
        this.applyExtras(e, game);
      }
      spawnHitSpark(game, this.x, this.y, this.color, this.type);
      if (this.type === 'glob') spawnPoisonSplash(game, this.x, this.y);
      if (this.type === 'shard') spawnFrostBurst(game, this.x, this.y);
      game.sound.hit();
    }
  }

  applyExtras(e, game) {
    if (this.slow > 0) e.applySlow(this.slow, this.slowDur, game.time);
    if (this.dotDps > 0) e.applyPoison(this.dotDps, this.dotDur, game.time);
  }
}

// =====================================================================
// 特效（纯视觉，无逻辑）
// =====================================================================
export class Effect {
  constructor() {
    this.dead = true;
  }

  init(o) {
    Object.assign(this, o);
    this.t = 0;
    this.life = o.life || 0.4;
    this.dead = false;
    return this;
  }

  update(dt) {
    this.t += dt;
    if (this.t >= this.life) this.dead = true;
  }

  get p() {
    return clamp(this.t / this.life, 0, 1);
  }
}

function fx(game, o) {
  const e = game.obtainEffect();
  e.init(o);
  return e;
}

export function spawnExplosion(game, x, y, r) {
  fx(game, {
    type: 'explosion',
    x,
    y,
    r,
    life: 0.38
  });
  const n = Math.min(14, 6 + Math.floor(r / 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + game.rng() * 0.5;
    const sp = 60 + game.rng() * 140;
    fx(game, {
      type: 'spark',
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 2 + game.rng() * 2.5,
      color: i % 3 === 0 ? '#ffd166' : '#f4791f',
      life: 0.28 + game.rng() * 0.22,
      gravity: 60
    });
  }
}

export function spawnHitSpark(game, x, y, color, kind) {
  const n = kind === 'shell' ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = game.rng() * TAU;
    const sp = 40 + game.rng() * 90;
    fx(game, {
      type: 'spark',
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 1.5 + game.rng() * 2,
      color,
      life: 0.16 + game.rng() * 0.14
    });
  }
}

export function spawnFrostBurst(game, x, y) {
  fx(game, { type: 'frost', x, y, r: 18, life: 0.35 });
}

export function spawnPoisonSplash(game, x, y) {
  fx(game, { type: 'poisonSplash', x, y, r: 20, life: 0.45 });
}

export function spawnPoisonBubble(game, x, y) {
  fx(game, {
    type: 'bubble',
    x: x + (game.rng() - 0.5) * 12,
    y: y + 6,
    vy: -18 - game.rng() * 14,
    life: 0.5,
    r: 1.5 + game.rng() * 2
  });
}

export function spawnDeath(game, enemy) {
  const n = enemy.def.boss ? 26 : 8;
  fx(game, { type: 'deathPuff', x: enemy.x, y: enemy.y, r: enemy.radius, color: enemy.def.color, life: 0.35 });
  for (let i = 0; i < n; i++) {
    const a = game.rng() * TAU;
    const sp = 50 + game.rng() * (enemy.def.boss ? 220 : 120);
    fx(game, {
      type: 'spark',
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 1.5 + game.rng() * 3,
      color: enemy.def.color,
      life: 0.3 + game.rng() * 0.3,
      gravity: 40
    });
  }
  if (enemy.def.boss) game.shake(9, 0.5);
}

export function spawnFloatText(game, x, y, text, color, opts = {}) {
  fx(game, {
    type: 'text',
    x,
    y,
    text,
    color,
    vy: -34,
    size: opts.size || 13,
    life: opts.life || 0.85
  });
}

export function spawnBeam(game, x, y, targets) {
  let px = x;
  let py = y;
  const pts = [];
  for (const t of targets) {
    const segs = 3;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const jitter = i === segs ? 0 : 7;
      pts.push({
        x: px + (t.x - px) * f + (game.rng() - 0.5) * jitter,
        y: py + (t.y - py) * f + (game.rng() - 0.5) * jitter
      });
    }
    px = t.x;
    py = t.y;
    spawnHitSpark(game, t.x, t.y, '#d9c2ff', 'arc');
  }
  fx(game, { type: 'beam', x, y, points: pts, life: 0.14 });
}

export function spawnHealPulse(game, x, y, r) {
  fx(game, { type: 'heal', x, y, r, life: 0.5 });
}

export function spawnMuzzle(game, x, y, angle, color) {
  fx(game, { type: 'muzzle', x, y, angle, color, life: 0.1 });
}

export function spawnLeak(game, x, y) {
  fx(game, { type: 'leak', x, y, life: 0.6 });
}

export function spawnBuildPuff(game, x, y) {
  for (let i = 0; i < 10; i++) {
    const a = game.rng() * TAU;
    fx(game, {
      type: 'spark',
      x,
      y,
      vx: Math.cos(a) * (50 + game.rng() * 60),
      vy: Math.sin(a) * (50 + game.rng() * 60) - 20,
      size: 2 + game.rng() * 2,
      color: '#cfe8d4',
      life: 0.3,
      gravity: 30
    });
  }
}
