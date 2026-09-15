/**
 * 游戏状态机：资源、波次、建造、伤害结算。
 * 不依赖 DOM，可在 Node 里无头跑（tools/smoke-test.mjs 就是这么验证平衡的）。
 */
import {
  COLS,
  ROWS,
  START_LIVES,
  MAX_LIVES,
  WAVE_BREAK,
  FIRST_WAVE_DELAY,
  EARLY_BONUS_GOLD,
  SELL_RATIO,
  TOWER_DEFS,
  upgradeCost,
  towerValue,
  enemyHpMul,
  enemySpeedMul,
  enemyRewardMul
} from './config.js';
import { buildLevel, T_EMPTY, T_ROAD, wavePreview } from './levels.js';
import { Enemy, Tower, Projectile, Effect, spawnDeath, spawnFloatText, spawnLeak, spawnBuildPuff } from './entities.js';
import { compact, dist2 } from './utils.js';

export const PHASE = {
  READY: 'ready', // 开局布防倒计时
  WAVE: 'wave', // 正在出怪 / 清怪
  BREAK: 'break', // 两波之间的间歇
  WON: 'won',
  LOST: 'lost'
};

/** 用来摊开成群敌人，避免完全重叠 */
const LANE_OFFSETS = [0, -10, 10, -5, 5, -14, 14];

/**
 * 不传音效时的空实现：必须能响应任意音效方法名，
 * 否则在 Node 里跑无头平衡测试时会因为 sound.shoot(...) 直接抛 TypeError。
 */
const NO_SOUND = new Proxy({}, { get: () => () => {} });

export class Game {
  constructor(levelDef, opts = {}) {
    this.level = buildLevel(levelDef);
    this.def = levelDef;
    this.rng = Math.random;
    this.sound = opts.sound || NO_SOUND;

    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.effects = [];
    this._projPool = [];
    this._fxPool = [];
    this.spawnQueue = [];
    this.spawnCursor = 0;
    this._laneCycle = 0;
    this.time = 0;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.waveElapsed = 0;
    this.countdown = 0;

    this.rebuildFromStart();

    this.listeners = new Set();
  }

  rebuildFromStart() {
    this.gold = this.def.gold;
    this.lives = Math.min(this.def.lives || START_LIVES, MAX_LIVES);
    this.waveIndex = 0; // 已完成的波数
    this.phase = PHASE.READY;
    this.countdown = FIRST_WAVE_DELAY;
    this.time = 0;
    this.towers.length = 0;
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.effects.length = 0;
    this.selectedTower = null;
    this.buildSelection = null;
    this.spawnQueue.length = 0;
    this.stats = {
      kills: 0,
      leaked: 0,
      leakedUnits: 0,
      goldEarned: 0,
      goldSpent: 0,
      damage: 0,
      towersBuilt: 0,
      towersSold: 0,
      upgrades: 0,
      livesLost: 0
    };
  }

  restart() {
    this.rebuildFromStart();
    this.emit('restart', {});
  }

  // ---------------- 事件 ----------------
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.listeners) fn(type, payload);
  }

  // ---------------- 对象池 ----------------
  obtainProjectile() {
    return this._projPool.pop() || new Projectile();
  }

  obtainEffect() {
    return this._fxPool.pop() || new Effect();
  }

  // ---------------- 查询 ----------------
  get totalWaves() {
    return this.def.waveCount;
  }

  get currentWaveNumber() {
    // 玩家视角的「第几波」：正在打的那一波
    return Math.min(this.totalWaves, this.phase === PHASE.WAVE ? this.waveIndex + 1 : this.waveIndex + 1);
  }

  get pendingWave() {
    return this.waveIndex < this.totalWaves ? this.level.waves[this.waveIndex] : null;
  }

  nextWaveInfo() {
    const w = this.pendingWave;
    if (!w) return null;
    return { number: this.waveIndex + 1, groups: wavePreview(w) };
  }

  tileType(cx, cy) {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return -1;
    return this.level.grid[cy * COLS + cx];
  }

  towerAt(cx, cy) {
    for (const t of this.towers) if (t.cx === cx && t.cy === cy) return t;
    return null;
  }

  canBuildAt(cx, cy) {
    if (this.tileType(cx, cy) !== T_EMPTY) return false;
    return !this.towerAt(cx, cy);
  }

  enemiesInRange(x, y, r) {
    const r2 = r * r;
    const out = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (dist2(e.x, e.y, x, y) <= r2) out.push(e);
    }
    return out;
  }

  /** 类似塔防经典设计：提前召唤下一波可拿金币奖励 */
  earlyBonus() {
    return Math.max(0, Math.floor(this.countdown) * EARLY_BONUS_GOLD);
  }

  // ---------------- 经济 ----------------
  earn(amount, x, y) {
    const n = Math.round(amount);
    if (n <= 0) return;
    this.gold += n;
    this.stats.goldEarned += n;
    if (x !== undefined) spawnFloatText(this, x, y, '+' + n, '#f5c542');
    this.emit('gold', { gold: this.gold, delta: n });
  }

  spend(amount) {
    if (this.gold < amount) return false;
    this.gold -= amount;
    this.stats.goldSpent += amount;
    this.emit('gold', { gold: this.gold, delta: -amount });
    return true;
  }

  // ---------------- 建造 ----------------
  build(key, cx, cy) {
    const def = TOWER_DEFS[key];
    if (!def) return { ok: false, reason: 'unknown' };
    if (!this.canBuildAt(cx, cy)) {
      this.emit('deny', { reason: this.tileType(cx, cy) === T_ROAD ? 'road' : 'occupied' });
      return { ok: false, reason: 'tile' };
    }
    if (this.gold < def.cost) {
      this.emit('deny', { reason: 'gold' });
      return { ok: false, reason: 'gold' };
    }
    this.spend(def.cost);
    const t = new Tower().init(key, cx, cy);
    this.towers.push(t);
    this.stats.towersBuilt++;
    spawnBuildPuff(this, t.x, t.y);
    this.sound.build?.();
    this.emit('build', { tower: t });
    return { ok: true, tower: t };
  }

  upgradeTower(t) {
    if (!t || t.maxed) return { ok: false, reason: 'maxed' };
    const cost = upgradeCost(t.key, t.level);
    if (this.gold < cost) {
      this.emit('deny', { reason: 'gold' });
      return { ok: false, reason: 'gold' };
    }
    this.spend(cost);
    t.level++;
    t.refresh();
    this.stats.upgrades++;
    spawnBuildPuff(this, t.x, t.y);
    this.sound.upgrade?.();
    this.emit('upgrade', { tower: t, cost });
    return { ok: true, cost };
  }

  sellTower(t) {
    if (!t) return { ok: false };
    const refund = Math.floor(towerValue(t.key, t.level) * SELL_RATIO);
    t.dead = true;
    this.gold += refund;
    this.stats.goldEarned += refund;
    this.stats.towersSold++;
    spawnFloatText(this, t.x, t.y, '+' + refund, '#f5c542');
    this.sound.sell?.();
    if (this.selectedTower === t) this.selectedTower = null;
    this.emit('sell', { tower: t, refund });
    return { ok: true, refund };
  }

  setTargetMode(t, mode) {
    if (!t) return;
    t.targetMode = mode;
    this.emit('targetMode', { tower: t, mode });
  }

  // ---------------- 波次 ----------------
  startWave(manual = false) {
    if (this.phase !== PHASE.READY && this.phase !== PHASE.BREAK) return;
    if (this.waveIndex >= this.totalWaves) return;
    const wave = this.level.waves[this.waveIndex];
    this.spawnQueue = [];
    const waveNo = this.waveIndex + 1;

    for (const g of wave) {
      const count = g.count;
      for (let i = 0; i < count; i++) {
        this.spawnQueue.push({
          time: g.delay + i * g.gap,
          type: g.type,
          lane: g.lane % this.level.paths.length,
          flying: !!g.flying
        });
      }
    }
    this.spawnQueue.sort((a, b) => a.time - b.time);
    this.spawnCursor = 0;
    this.waveElapsed = 0;
    this.phase = PHASE.WAVE;

    if (manual) {
      const bonus = this.earlyBonus();
      if (bonus > 0) {
        this.earn(bonus);
        this.emit('toast', { text: `提前召唤奖励 +${bonus} 金币`, kind: 'gold' });
      }
    }
    this.sound.waveStart?.();
    this.emit('waveStart', { number: waveNo, groups: wavePreview(wave) });
  }

  /** 玩家点「下一波」 */
  requestNextWave() {
    if (this.phase === PHASE.READY || this.phase === PHASE.BREAK) {
      this.startWave(true);
      return true;
    }
    return false;
  }

  spawnEnemy(type, lane, flying) {
    const waveNo = this.waveIndex + 1;
    const path = flying ? this.level.airPaths[lane] : this.level.paths[lane];
    const off = LANE_OFFSETS[this._laneCycle++ % LANE_OFFSETS.length];
    const e = new Enemy().init(type, path, {
      hpMul: enemyHpMul(this.def.hpMul, waveNo),
      speedMul: enemySpeedMul(waveNo),
      rewardMul: enemyRewardMul(waveNo),
      laneOffset: flying ? off * 0.6 : off,
      wave: waveNo
    });
    this.enemies.push(e);
    return e;
  }

  finishWave() {
    this.waveIndex++;
    const bonus = 20 + this.waveIndex * 8;
    this.earn(bonus);
    this.sound.waveClear?.();
    this.emit('waveClear', { number: this.waveIndex, bonus });
    if (this.waveIndex >= this.totalWaves) {
      this.phase = PHASE.WON;
      this.sound.win?.();
      this.emit('win', { stats: this.summary() });
    } else {
      this.phase = PHASE.BREAK;
      this.countdown = WAVE_BREAK;
    }
  }

  // ---------------- 伤害与生死 ----------------
  damageEnemy(e, amount, kind, tower) {
    if (e.dead || e.hp <= 0) return 0;
    if (tower) e.lastHitBy = tower;
    const dealt = e.takeDamage(amount, kind, this.time);
    this.stats.damage += dealt;
    if (tower) tower.damageDealt += dealt;
    if (e.hp <= 0) this.killEnemy(e, false);
    return dealt;
  }

  killEnemy(e, byPoison) {
    if (e.dead) return;
    e.dead = true;
    this.stats.kills++;
    if (e.lastHitBy && !e.lastHitBy.dead) e.lastHitBy.kills++;
    spawnDeath(this, e);
    this.earn(e.reward, e.x, e.y - 6);
    if (!byPoison) this.sound.die?.();
    this.emit('kill', { enemy: e });
  }

  leak(e) {
    if (e.dead) return;
    e.dead = true;
    const dmg = e.def.leak;
    this.lives -= dmg;
    this.stats.leaked++;
    this.stats.leakedUnits += dmg;
    this.stats.livesLost += dmg;
    spawnLeak(this, e.x, e.y);
    spawnFloatText(this, this.level.goal.x, this.level.goal.y - 20, `-${dmg}`, '#ef5b6b', { size: 16, life: 1 });
    this.shake(6, 0.3);
    this.sound.leak?.();
    this.emit('leak', { enemy: e, damage: dmg });
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = PHASE.LOST;
      this.sound.lose?.();
      this.emit('lose', { stats: this.summary() });
    }
  }

  shake(amount, time) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  // ---------------- 主循环 ----------------
  update(dt) {
    if (this.phase === PHASE.WON || this.phase === PHASE.LOST) {
      this.updateVisuals(dt);
      return;
    }
    this.time += dt;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeAmount = 0;
    }

    // 倒计时 → 自动开波
    if (this.phase === PHASE.READY || this.phase === PHASE.BREAK) {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.startWave(false);
      }
    }

    // 出怪
    if (this.phase === PHASE.WAVE) {
      this.waveElapsed += dt;
      while (this.spawnCursor < this.spawnQueue.length && this.spawnQueue[this.spawnCursor].time <= this.waveElapsed) {
        const s = this.spawnQueue[this.spawnCursor++];
        this.spawnEnemy(s.type, s.lane, s.flying);
      }
    }

    // 敌人
    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    compact(this.enemies);

    // 防御塔
    for (const t of this.towers) if (!t.dead) t.update(dt, this);
    compact(this.towers);
    if (this.selectedTower && this.selectedTower.dead) this.selectedTower = null;

    this.updateVisuals(dt);

    // 收尾判定：怪出完 + 场上清空
    if (
      this.phase === PHASE.WAVE &&
      this.spawnCursor >= this.spawnQueue.length &&
      this.enemies.length === 0
    ) {
      this.finishWave();
    }
  }

  updateVisuals(dt) {
    for (const p of this.projectiles) if (!p.dead) p.update(dt, this);
    for (let i = 0; i < this.projectiles.length; i++) {
      if (this.projectiles[i].dead) this._projPool.push(this.projectiles[i]);
    }
    compact(this.projectiles);

    for (const f of this.effects) if (!f.dead) f.update(dt, this);
    for (let i = 0; i < this.effects.length; i++) {
      if (this.effects[i].dead) this._fxPool.push(this.effects[i]);
    }
    compact(this.effects);
    // 特效池上限，防止极端情况下内存膨胀
    if (this._fxPool.length > 400) this._fxPool.length = 400;
    if (this._projPool.length > 200) this._projPool.length = 200;
  }

  // ---------------- 结算 ----------------
  summary() {
    const win = this.phase === PHASE.WON;
    const score = Math.round(
      this.stats.kills * 10 +
        this.stats.goldEarned * 1 +
        this.waveIndex * 120 +
        this.lives * 60 +
        (win ? 1500 : 0)
    );
    return {
      levelId: this.def.id,
      levelName: this.def.name,
      win,
      waveReached: this.waveIndex + (win ? 0 : 1),
      totalWaves: this.totalWaves,
      lives: this.lives,
      gold: this.gold,
      score,
      ...this.stats
    };
  }
}
