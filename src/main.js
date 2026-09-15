/**
 * 入口：应用装配、主循环、屏幕适配、生命周期。
 * 主循环用固定步长累加器，保证 60Hz / 120Hz / 掉帧时游戏速度一致。
 */
import { STEP, MAX_STEPS_PER_FRAME, SPEEDS, TOWER_ORDER } from './config.js';
import { LEVELS } from './levels.js';
import { Game, PHASE } from './game.js';
import { buildStatic, computeView, draw } from './render.js';
import { UI } from './ui.js';
import { attachInput } from './input.js';
import { Sound } from './audio.js';
import { loadSave, saveSave } from './utils.js';

class App {
  constructor() {
    this.canvas = document.querySelector('#game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.save = loadSave();
    this.audio = new Sound();
    this.audio.setEnabled(this.save.sound);

    this.game = null;
    this.staticLayer = null;
    this.levelIndex = Math.min(this.save.lastLevel || 0, LEVELS.length - 1);
    this.view = computeView(1, 1);
    this.dpr = 1;
    this.speed = 1;
    this.paused = false;
    this.buildKey = null;
    this.hover = null;
    this.acc = 0;
    this.lastTs = 0;

    this.ui = new UI(this);
    attachInput(this.canvas, this);

    this._wireWindow();
    this.resize();
    this.syncSpeedButton();
    this.syncPauseButton();
    this.syncSoundButton();
    this.ui.showBoot();
    this.frameCount = 0;

    requestAnimationFrame((ts) => this.frame(ts));
  }

  // ---------------- 生命周期 ----------------
  _wireWindow() {
    const onResize = () => {
      this.resize();
      this.checkOrientation();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 260));

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(document.querySelector('#stage'));
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend();
        if (this.game && (this.game.phase === PHASE.WAVE || this.game.phase === PHASE.READY || this.game.phase === PHASE.BREAK)) {
          this.paused = true;
          this.syncPauseButton();
        }
      } else {
        this.audio.resume();
        this.lastTs = performance.now();
        this.acc = 0;
      }
    });

    // 弹窗遮罩点击关闭（仅标记为可关闭的弹窗，结算弹窗不允许误关）
    this.ui.el.dialog.addEventListener('click', (ev) => {
      if (ev.target !== this.ui.el.dialog) return;
      if (this.ui.el.dialog.dataset.dismissible !== '1') return;
      this.ui.hideDialog();
      this.resume();
    });

    document.querySelector('#btn-boot-start').addEventListener('click', () => this.boot());
  }

  boot() {
    this.audio.unlock();
    this.audio.click();
    this.ui.hideBoot();
    this.enterImmersive();
    this.ui.showLevelSelect();
    this.checkOrientation();
  }

  /** 尝试全屏并锁定横屏（不支持的平台会静默失败，例如 iOS Safari） */
  async enterImmersive() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      /* 忽略：桌面浏览器或策略限制 */
    }
    // 只有玩家本来就是横屏拿着的，才顺手锁死，避免硬扭转手机方向
    if (window.innerWidth > window.innerHeight) {
      try {
        await screen.orientation?.lock?.('landscape');
      } catch {
        /* 忽略 */
      }
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.view = computeView(cssW, cssH);
  }

  checkOrientation(force) {
    const portrait = window.innerHeight > window.innerWidth;
    if (!portrait) {
      this.ui.hideRotateHint();
      return;
    }
    if (!this.game) return;
    if (this.save.rotateHintShown && !force) return;
    this.ui.showRotateHint();
  }

  // ---------------- 关卡流程 ----------------
  startLevel(index) {
    const def = LEVELS[index];
    if (!def) return;
    this.levelIndex = index;
    this.save.lastLevel = index;
    this.persist();

    this.game = new Game(def, { sound: this.audio });
    this.staticLayer = buildStatic(this.game.level);
    this.acc = 0;
    this.paused = false;
    this.buildKey = null;
    this.hover = null;
    this.speed = 1;

    this.ui.hideBoot();
    this.ui.hideDialog();
    this.ui.bind(this.game);
    this.ui.updateDock(this.game);
    this.syncSpeedButton();
    this.syncPauseButton();
    this.checkOrientation();
  }

  restartLevel() {
    if (!this.game) return;
    this.game.restart();
    this.buildKey = null;
    this.hover = null;
    this.acc = 0;
    this.paused = false;
    this.ui.hideDialog();
    this.ui.hidePanel();
    this.ui.syncHud(this.game, true);
    this.ui.updateDock(this.game);
    this.audio.resume();
    this.syncPauseButton();
  }

  openLevelSelect() {
    this.pause();
    this.ui.showLevelSelect();
  }

  openMenu() {
    this.pause();
    const actions = [
      { label: '继续游戏', cls: 'primary', fn: () => this.resume() },
      { label: '重开本关', fn: () => this.restartLevel() },
      { label: this.save.sound ? '关闭音效' : '打开音效', fn: () => this.toggleSound() },
      { label: '选择关卡', fn: () => this.openLevelSelect() }
    ];
    // 还没装到桌面的话，给一个安装入口（Chrome 不再自动弹安装提示了）
    const install = this.ui.installAction();
    if (install) actions.push(install);
    this.ui.showDialog({
      title: '暂停',
      sub: `${this.game ? this.game.def.name : ''} · 第 ${this.game ? Math.min(this.game.waveIndex + 1, this.game.totalWaves) : 1} / ${this.game ? this.game.totalWaves : 1} 波`,
      body: `<div class="muted">游戏已暂停，随时可以回来。</div>`,
      actions,
      dismissible: true
    });
  }

  pause() {
    this.paused = true;
    this.audio.suspend();
    this.syncPauseButton();
  }

  resume() {
    this.paused = false;
    this.audio.resume();
    this.syncPauseButton();
    this.lastTs = performance.now();
    this.acc = 0;
  }

  togglePause() {
    if (this.ui.dialogOpen) return;
    if (this.paused) this.resume();
    else this.openMenu();
  }

  syncPauseButton() {
    const b = this.ui.el.btnPause;
    b.textContent = this.paused ? '▶' : '❚❚';
    b.title = this.paused ? '继续' : '暂停';
  }

  // ---------------- 操作 ----------------
  setBuildKey(key) {
    this.buildKey = key;
    if (key) this.ui.hidePanel();
    this.ui.updateDock(this.game);
  }

  toggleBuild(key) {
    if (key === null) {
      this.setBuildKey(null);
      return;
    }
    this.setBuildKey(this.buildKey === key ? null : key);
  }

  selectTowerByIndex(i) {
    const key = TOWER_ORDER[i];
    if (key) {
      this.audio.click();
      this.toggleBuild(key);
    }
  }

  manualNextWave() {
    if (!this.game || this.paused || this.ui.dialogOpen) return;
    this.game.requestNextWave();
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length];
    this.acc = 0;
    this.syncSpeedButton();
    this.ui.toast(`速度 ${this.speed}×`, '');
  }

  syncSpeedButton() {
    const b = this.ui.el.btnSpeed;
    b.textContent = `${this.speed}×`;
    b.classList.toggle('active', this.speed > 1);
  }

  syncSoundButton() {
    const b = this.ui.el.btnSound;
    b.textContent = this.save.sound ? '♪' : '✕';
    b.classList.toggle('active', this.save.sound);
    b.title = this.save.sound ? '音效开' : '音效关';
  }

  toggleSound() {
    this.save.sound = !this.save.sound;
    this.audio.setEnabled(this.save.sound);
    if (this.save.sound) this.audio.resume();
    this.syncSoundButton();
    this.persist();
  }

  persist() {
    saveSave(this.save);
  }

  // ---------------- 主循环 ----------------
  frame(ts) {
    requestAnimationFrame((t) => this.frame(t));
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25; // 切后台回来直接丢弃这段时间

    const active = this.game && !this.paused && !this.ui.dialogOpen;
    if (active && this.game.phase !== PHASE.WON && this.game.phase !== PHASE.LOST) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        this.game.update(STEP * this.speed);
        this.acc -= STEP;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      // 倒计时数字每秒都在变，但也不必每帧写 DOM
      if ((this.frameCount++ & 3) === 0) this.ui.syncHud(this.game);
    } else if (this.game) {
      // 暂停 / 结算状态下仍推进纯视觉部分，界面不至于僵死
      this.game.updateVisuals(STEP);
      if ((this.frameCount++ & 7) === 0) this.ui.syncHud(this.game);
    }

    if (this.game) {
      draw(this.ctx, this.game, this.view, {
        staticLayer: this.staticLayer,
        hover: this.hover,
        buildKey: this.buildKey,
        dpr: this.dpr,
        time: this.game.time
      });
    }
  }
}

/**
 * 注册 Service Worker，让「添加到主屏幕」后的游戏能离线打开。
 * 原生壳（Capacitor）里资源本来就是本地的，注册反而会在 cap sync 后读到旧缓存，所以跳过。
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.Capacitor) return;
  const localOk = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!localOk) return; // http + 局域网 IP 下浏览器不允许注册

  // 用 manifest 的位置反推「应用根目录」而不是写死 / 或当前目录：
  // 这样部署在子目录（如 GitHub Pages 的 /plane-td/）时依然正确，
  // 而开发预览页（tools/ 下、没有 manifest）会自动跳过注册，不会报 404。
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;
  navigator.serviceWorker
    .register(new URL('sw.js', link.href), { scope: new URL('./', link.href) })
    .catch(() => {});
}

function bootstrap() {
  window.__game = new App();
  registerServiceWorker();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bootstrap();
} else {
  window.addEventListener('DOMContentLoaded', bootstrap);
}
