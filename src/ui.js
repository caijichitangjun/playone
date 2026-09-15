/**
 * UI 层：所有 HTML/CSS 交互（HUD、防御塔面板、弹窗、关卡选择、提示）。
 * 画布只画游戏世界，UI 一律用 DOM —— 触控热区与文字清晰度都更有保障。
 */
import {
  TOWER_DEFS,
  TOWER_ORDER,
  towerStats,
  upgradeCost,
  towerValue,
  MAX_TOWER_LEVEL,
  SELL_RATIO
} from './config.js';
import { LEVELS } from './levels.js';
import { PHASE } from './game.js';

const TARGET_MODES = [
  { key: 'first', label: '最前' },
  { key: 'last', label: '最后' },
  { key: 'strong', label: '最强' },
  { key: 'weak', label: '最弱' },
  { key: 'close', label: '最近' }
];

/**
 * 显示一个原本 `display:none` 的元素。
 * 去掉 hidden 后强制读一次 offsetWidth 触发重排 —— iOS Safari 需要这一下才会真正
 * 启动 CSS 进场动画，否则动画可能卡在首帧（历史上就会表现为弹窗不显示）。
 * 与 UI.flag() 里重启动画用的是同一个技巧。
 */
function reveal(el) {
  el.classList.remove('hidden');
  void el.offsetWidth;
}

/** 每种塔的小图标（内联 SVG，省去图片资源与额外请求） */
function towerIconSVG(key) {
  const d = TOWER_DEFS[key];
  const c = d.color;
  const cd = d.colorDark;
  const base = `<circle cx="16" cy="16" r="13.5" fill="#23282f" stroke="${c}" stroke-width="2"/>`;
  let body = '';
  switch (key) {
    case 'arrow':
      body = `
        <path d="M7 16h12" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M18 9.5l7 6.5-7 6.5z" fill="${c}"/>
        <path d="M8.5 9.5q6.5 6.5 0 13" stroke="#e8f7ec" stroke-width="1.8" fill="none"/>`;
      break;
    case 'cannon':
      body = `
        <circle cx="13" cy="16" r="7" fill="${cd}" stroke="${c}" stroke-width="1.6"/>
        <rect x="12" y="11.5" width="17" height="9" rx="2.5" fill="${cd}" stroke="${c}" stroke-width="1.6"/>
        <circle cx="26" cy="16" r="2" fill="${c}"/>`;
      break;
    case 'frost':
      body = `
        <polygon points="16,4.5 25.5,10 25.5,22 16,27.5 6.5,22 6.5,10" fill="${cd}" stroke="${c}" stroke-width="1.6"/>
        <path d="M16 9.5v13M10.4 12.5l11.2 7M21.6 12.5l-11.2 7" stroke="#e6faff" stroke-width="1.5" stroke-linecap="round"/>`;
      break;
    case 'tesla':
      body = `
        <rect x="13" y="7.5" width="6" height="17" rx="2.5" fill="#3b3350" stroke="${c}" stroke-width="1.6"/>
        <circle cx="16" cy="16" r="4" fill="#efe3ff"/>
        <path d="M16 3.5l-3.4 7h4.2l-3 7" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
      break;
    case 'poison':
      body = `
        <circle cx="16" cy="17" r="9.5" fill="${cd}" stroke="${c}" stroke-width="1.6"/>
        <circle cx="16" cy="17" r="5.6" fill="${c}"/>
        <circle cx="13.4" cy="14.4" r="1.7" fill="#d6f07a"/>
        <circle cx="19" cy="19.4" r="1.4" fill="#d6f07a"/>`;
      break;
  }
  return `<svg class="ticon" viewBox="0 0 32 32" aria-hidden="true">${base}${body}</svg>`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      lives: document.querySelector('#st-lives b'),
      gold: document.querySelector('#st-gold b'),
      wave: document.querySelector('#st-wave b'),
      score: document.querySelector('#st-score b'),
      statLives: document.querySelector('#st-lives'),
      statGold: document.querySelector('#st-gold'),
      btnWave: document.querySelector('#btn-wave'),
      btnSpeed: document.querySelector('#btn-speed'),
      btnSound: document.querySelector('#btn-sound'),
      btnPause: document.querySelector('#btn-pause'),
      btnMenu: document.querySelector('#btn-menu'),
      towerList: document.querySelector('#tower-list'),
      btnCancel: document.querySelector('#btn-cancel-build'),
      panel: document.querySelector('#tower-panel'),
      dialog: document.querySelector('#dialog'),
      dlgTitle: document.querySelector('#dlg-title'),
      dlgBody: document.querySelector('#dlg-body'),
      dlgActions: document.querySelector('#dlg-actions'),
      toasts: document.querySelector('#toasts'),
      flag: document.querySelector('#wave-flag'),
      preview: document.querySelector('#wave-preview'),
      boot: document.querySelector('#boot'),
      rotate: document.querySelector('#rotate-hint')
    };
    this._last = {};
    this.panelTower = null;
    // Android Chrome 早就取消了自动弹安装提示，只能由页面主动调用，所以先接住这个事件备用
    this.installEvent = null;
    this._buildDock();
    this._wire();
    this._wireInstall();
  }

  // ---------------- 底部塔栏 ----------------
  _buildDock() {
    this.el.towerList.innerHTML = '';
    for (const key of TOWER_ORDER) {
      const d = TOWER_DEFS[key];
      const btn = document.createElement('button');
      btn.className = 'tower-btn';
      btn.dataset.key = key;
      btn.innerHTML = `${towerIconSVG(key)}
        <span class="tname">${d.name}</span>
        <span class="tcost">${d.cost}</span>`;
      btn.title = `${d.name}（${d.cost} 金）\n${d.desc}`;
      btn.addEventListener('click', () => {
        this.app.audio.click();
        this.app.toggleBuild(key);
      });
      this.el.towerList.appendChild(btn);
    }
  }

  _wire() {
    const a = this.app;
    this.el.btnWave.addEventListener('click', () => a.manualNextWave());
    this.el.btnSpeed.addEventListener('click', () => a.cycleSpeed());
    this.el.btnSound.addEventListener('click', () => a.toggleSound());
    this.el.btnPause.addEventListener('click', () => a.togglePause());
    this.el.btnMenu.addEventListener('click', () => a.openMenu());
    this.el.btnCancel.addEventListener('click', () => a.toggleBuild(null));
  }

  // ---------------- 与 Game 事件对接 ----------------
  bind(game) {
    game.on((type, payload) => this.onGameEvent(type, payload));
    this.syncHud(game, true);
    this.updateDock(game);
    this.hidePanel();
    this.hideDialog();
  }

  onGameEvent(type, payload) {
    switch (type) {
      case 'waveStart':
        this.flag(`第 ${payload.number} 波 来袭`, false);
        break;
      case 'waveClear':
        this.flag(`第 ${payload.number} 波 清空  +${payload.bonus}`, true);
        break;
      case 'build':
        // 建造本身已有画面反馈，不再弹提示（连续摆塔时太吵）
        break;
      case 'upgrade':
        this.toast(`升级至 Lv.${payload.tower.level}`, 'good');
        this._flash('gold');
        break;
      case 'sell':
        this.toast(`出售返还 ${payload.refund} 金币`, 'gold');
        this._flash('gold');
        break;
      case 'leak':
        this.toast(`城堡被突破 −${payload.damage} 生命`, 'bad');
        this._flash('lives');
        break;
      case 'deny':
        this.toast(payload.reason === 'gold' ? '金币不足' : '这里不能建造', 'bad');
        break;
      case 'toast':
        this.toast(payload.text, payload.kind);
        break;
      case 'win':
        this.hidePanel();
        this.showResult(payload.stats);
        break;
      case 'lose':
        this.hidePanel();
        this.showResult(payload.stats);
        break;
      case 'gold':
        this._flash('gold');
        break;
    }
    this.syncHud(this.app.game);
    this.updateDock(this.app.game);
    if (this.panelTower) {
      if (this.panelTower.dead) {
        this.hidePanel();
      } else if (type === 'upgrade' || type === 'targetMode') {
        this.renderPanel(this.app.game, this.panelTower);
      } else if (type === 'gold' || type === 'build' || type === 'sell') {
        // 击杀/收钱都会触发 gold 事件，此时只刷新「买得起吗」，不重建整个面板
        this.refreshPanelAffordability(this.app.game);
      }
    }
  }

  /** 只更新升级按钮的可用状态，避免每次击杀都重建 DOM */
  refreshPanelAffordability(game) {
    const t = this.panelTower;
    if (!t) return;
    const btn = this.el.panel.querySelector('button[data-act="upgrade"]');
    if (!btn) return;
    if (t.maxed) return;
    const affordable = game.gold >= upgradeCost(t.key, t.level);
    if (btn.disabled === !affordable) return;
    btn.disabled = !affordable;
    const label = `升级 ${upgradeCost(t.key, t.level)}`;
    if (btn.textContent.trim() !== label) btn.textContent = label;
  }

  _flash(key) {
    const node = key === 'lives' ? this.el.statLives : this.el.statGold;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  // ---------------- HUD ----------------
  liveScore(game) {
    const s = game.stats;
    return Math.round(s.kills * 10 + s.goldEarned + game.waveIndex * 120 + game.lives * 60);
  }

  syncHud(game, force) {
    if (!game) return;
    const last = this._last;
    const set = (node, value) => {
      const v = String(value);
      if (node.textContent !== v) node.textContent = v;
    };
    set(this.el.lives, game.lives);
    set(this.el.gold, Math.floor(game.gold));
    set(this.el.wave, `${Math.min(game.waveIndex + 1, game.totalWaves)}/${game.totalWaves}`);
    set(this.el.score, this.liveScore(game));

    // 下一波按钮
    const btn = this.el.btnWave;
    if (game.phase === PHASE.READY || game.phase === PHASE.BREAK) {
      const next = Math.min(game.waveIndex + 1, game.totalWaves);
      const bonus = game.earlyBonus();
      btn.disabled = false;
      btn.classList.add('primary');
      set(btn, `第${next}波 ${Math.ceil(game.countdown)}s${bonus > 0 ? ` +${bonus}` : ''}`);
    } else if (game.phase === PHASE.WAVE) {
      btn.disabled = true;
      btn.classList.remove('primary');
      const remain = game.enemies.length;
      set(btn, `第${game.waveIndex + 1}波 剩${remain}`);
    } else {
      btn.disabled = true;
      btn.classList.remove('primary');
      set(btn, game.phase === PHASE.WON ? '已通关' : '已失败');
    }
    this.updateWavePreview(game);
    if (force) last.force = true;
  }

  /** 下一波阵容预告：飞行/首领高亮，让玩家提前调整布防 */
  updateWavePreview(game) {
    const el = this.el.preview;
    const preparing = game.phase === PHASE.READY || game.phase === PHASE.BREAK;
    const info = preparing ? game.nextWaveInfo() : null;
    if (!info) {
      if (this._last.previewKey !== 'none') {
        this._last.previewKey = 'none';
        el.classList.add('hidden');
      }
      return;
    }
    const key = `${info.number}|${info.groups.map((g) => g.type + g.count).join(',')}`;
    if (this._last.previewKey === key) return;
    this._last.previewKey = key;
    el.innerHTML =
      `<span class="wp-title">下一波 ${info.number}/${game.totalWaves}</span>` +
      info.groups
        .map((g) => {
          const cls = g.boss ? 'wp-boss' : g.flying ? 'wp-fly' : '';
          return `<span class="wp-item ${cls}"><i class="wp-dot" style="background:${g.color}"></i>${g.name}×${g.count}</span>`;
        })
        .join('');
    el.classList.remove('hidden');
  }

  updateDock(game) {
    if (!game) return;
    const sel = this.app.buildKey;
    for (const btn of this.el.towerList.children) {
      const key = btn.dataset.key;
      const def = TOWER_DEFS[key];
      btn.classList.toggle('sel', sel === key);
      btn.classList.toggle('poor', game.gold < def.cost);
    }
    this.el.btnCancel.hidden = !sel;
  }

  // ---------------- 塔详情面板 ----------------
  showPanel(game, tower) {
    this.panelTower = tower;
    game.selectedTower = tower;
    this.renderPanel(game, tower);
    reveal(this.el.panel);
  }

  hidePanel() {
    this.panelTower = null;
    if (this.app.game) this.app.game.selectedTower = null;
    this.el.panel.classList.add('hidden');
  }

  renderPanel(game, t) {
    const d = TOWER_DEFS[t.key];
    const s = t.stats;
    const maxed = t.level >= MAX_TOWER_LEVEL;
    const next = maxed ? null : towerStats(t.key, t.level + 1);
    const upCost = maxed ? 0 : upgradeCost(t.key, t.level);
    const refund = Math.floor(towerValue(t.key, t.level) * SELL_RATIO);
    const row = (k, cur, nxt, suffix = '') =>
      `<div class="prow"><span class="k">${k}</span><span class="v">${cur}${suffix}${
        nxt !== null ? ` → <b class="up">${nxt}${suffix}</b>` : ''
      }</span></div>`;

    const fmt = (n) => (n >= 100 ? Math.round(n) : n.toFixed(1));

    let special = '';
    if (d.splash) special = row('爆炸范围', Math.round(s.splash), next ? Math.round(next.splash) : null);
    if (d.slow) special = row('减速', Math.round(s.slow * 100), next ? Math.round(next.slow * 100) : null, '%');
    if (d.chain) special = row('连锁数', s.chain, next ? next.chain : null, ' 个');
    if (d.dotDps) special = row('毒伤', fmt(s.dotDps), next ? fmt(next.dotDps) : null, '/s');

    const segs = TARGET_MODES.map(
      (m) => `<button data-mode="${m.key}" class="${t.targetMode === m.key ? 'on' : ''}">${m.label}</button>`
    ).join('');

    this.el.panel.innerHTML = `
      <div class="panel-head">
        ${towerIconSVG(t.key)}
        <div>
          <div class="ptitle">${d.name}</div>
          <div class="plevel">等级 ${t.level}/${MAX_TOWER_LEVEL} · ${maxed ? '已满级' : `升级需 ${upCost} 金`}</div>
        </div>
        <button class="pclose" data-act="close" aria-label="关闭">✕</button>
      </div>
      ${row('伤害', fmt(s.damage), next ? fmt(next.damage) : null)}
      ${row('攻击间隔', s.cooldown.toFixed(2), next ? next.cooldown.toFixed(2) : null, 's')}
      ${row('射程', Math.round(s.range), next ? Math.round(next.range) : null)}
      ${special}
      ${row('DPS', fmt(s.dps), next ? fmt(next.dps) : null)}
      <div class="prow"><span class="k">本塔战绩</span><span class="v">击杀 ${t.kills} · 伤害 ${Math.round(t.damageDealt)}</span></div>
      <div class="pdesc">${d.desc}</div>
      <div class="pseg" title="攻击优先级">${segs}</div>
      <div class="pactions">
        <button class="btn primary" data-act="upgrade" ${maxed || game.gold < upCost ? 'disabled' : ''}>
          ${maxed ? '已满级' : `升级 ${upCost}`}
        </button>
        <button class="btn warn" data-act="sell">出售 +${refund}</button>
      </div>
    `;

    this.el.panel.onclick = (ev) => {
      const btn = ev.target.closest('button');
      if (!btn || !this.panelTower) return;
      const act = btn.dataset.act;
      if (act === 'close') {
        this.hidePanel();
      } else if (act === 'upgrade') {
        const r = game.upgradeTower(this.panelTower);
        if (!r.ok && r.reason === 'gold') this.toast('金币不足', 'bad');
      } else if (act === 'sell') {
        game.sellTower(this.panelTower);
        this.hidePanel();
      } else if (btn.dataset.mode) {
        game.setTargetMode(this.panelTower, btn.dataset.mode);
      }
    };
  }

  // ---------------- 安装到桌面 ----------------
  _wireInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // 拦下来，改成由我们在菜单里主动触发
      this.installEvent = e;
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = null;
      this.toast('已安装到桌面，下次从图标直接进', 'good');
    });
  }

  /** 是否已经以「已安装应用」的形式在运行 */
  get standalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  }

  get isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  /**
   * 返回一个可放进暂停菜单的动作；已经装好了就返回 null。
   * Android/Chrome 能直接调起系统安装框；iOS 只能给操作指引（Safari 不提供任何安装 API）。
   */
  installAction() {
    if (this.standalone) return null;
    if (this.installEvent) {
      return {
        label: '安装到桌面',
        cls: 'primary',
        fn: async () => {
          const ev = this.installEvent;
          this.installEvent = null;
          try {
            ev.prompt();
            await ev.userChoice;
          } catch {
            /* 用户取消或浏览器不支持 */
          }
        }
      };
    }
    return { label: '怎么装到桌面', fn: () => this.showInstallHelp() };
  }

  showInstallHelp() {
    const ios = this.isIOS;
    const steps = ios
      ? '用 <b>Safari</b> 打开本页 → 点底部的<b>分享</b>按钮 → 选<b>「添加到主屏幕」</b> → 添加。'
      : '用 <b>Chrome</b> 打开本页 → 点右上角 <b>⋮</b> 菜单 → 选<b>「安装应用」</b>（若显示「添加到主屏幕」，说明当前浏览器不支持安装，换成 Chrome 再试）。';
    this.showDialog({
      title: '安装到桌面',
      sub: '装好后是全屏运行、有独立图标，而且断网也能玩。',
      body: `<div class="muted" style="text-align:left;line-height:1.9">${steps}
        <br>注意：微信、QQ、UC 等内置浏览器不支持安装，请用系统自带的 Safari / Chrome。</div>`,
      actions: [{ label: '知道了', cls: 'primary', fn: () => this.hideDialog() }]
    });
  }

  // ---------------- 提示 ----------------
  /** 最多同时显示 3 条，超出就顶掉最旧的，免得挡住战场 */
  toast(text, kind = '') {
    const box = this.el.toasts;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const div = document.createElement('div');
    div.className = 'toast ' + kind;
    div.textContent = text;
    box.appendChild(div);
    setTimeout(() => div.remove(), 1900);
  }

  flag(text, soft) {
    const f = this.el.flag;
    f.textContent = text;
    f.className = soft ? 'soft' : '';
    // 重启动画
    f.style.animation = 'none';
    void f.offsetWidth;
    f.style.animation = '';
  }

  // ---------------- 弹窗 ----------------
  showDialog({ title, titleClass = '', sub = '', body = '', actions = [], dismissible = false }) {
    this.el.dlgTitle.textContent = title;
    this.el.dlgTitle.className = titleClass;
    this.el.dlgBody.innerHTML = `${sub ? `<p class="dlg-sub">${sub}</p>` : ''}${body}`;
    this.el.dlgActions.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || 'ghost');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        this.app.audio.click();
        a.fn();
      });
      this.el.dlgActions.appendChild(b);
    }
    this.el.dialog.classList.remove('hidden');
    this.el.dialog.dataset.dismissible = dismissible ? '1' : '';
    void this.el.dialog.offsetWidth; // iOS：让进场动画真正跑起来
  }

  hideDialog() {
    this.el.dialog.classList.add('hidden');
  }

  get dialogOpen() {
    return !this.el.dialog.classList.contains('hidden');
  }

  showBoot() {
    reveal(this.el.boot);
  }

  hideBoot() {
    this.el.boot.classList.add('hidden');
  }

  // ---------------- 结算 ----------------
  showResult(stats) {
    const win = stats.win;
    const best = this.app.save.best[stats.levelId];
    const isRecord = !best || stats.score > best.score;
    const cell = (k, v) => `<div class="result-cell"><div class="rk">${k}</div><div class="rv">${v}</div></div>`;
    const body = `
      <div class="result-grid">
        ${cell('坚守波次', `${stats.waveReached}/${stats.totalWaves}`)}
        ${cell('击杀', stats.kills)}
        ${cell('剩余生命', stats.lives)}
        ${cell('累计金币', stats.goldEarned)}
      </div>
      <div class="score-line">本局得分 <b>${stats.score}</b>${isRecord ? ' · 新纪录！' : best ? ` · 最高 ${best.score}` : ''}</div>
    `;

    const actions = [];
    if (win) {
      const nextIdx = LEVELS.findIndex((l) => l.id === stats.levelId) + 1;
      const hasNext = nextIdx < LEVELS.length;
      if (hasNext) {
        actions.push({ label: `进入下一关：${LEVELS[nextIdx].name}`, cls: 'primary', fn: () => this.app.startLevel(nextIdx) });
      }
      actions.push({ label: '再玩一次', fn: () => this.app.restartLevel() });
      actions.push({ label: '选择关卡', fn: () => this.app.openLevelSelect() });
    } else {
      actions.push({ label: '重试本关', cls: 'primary', fn: () => this.app.restartLevel() });
      actions.push({ label: '选择关卡', fn: () => this.app.openLevelSelect() });
    }

    this.showDialog({
      title: win ? '守住了！' : '城堡失守',
      titleClass: win ? 'win' : 'lose',
      sub: win
        ? `${stats.levelName} · 全部 ${stats.totalWaves} 波敌人已被击退。`
        : `${stats.levelName} · 在第 ${stats.waveReached} 波被突破，再来一次试试别的塔组合。`,
      body,
      actions
    });
  }

  // ---------------- 关卡选择 ----------------
  showLevelSelect() {
    const save = this.app.save;
    const body = `<div class="level-list">${LEVELS.map((lv, i) => {
      const unlocked = i < save.unlocked;
      const b = save.best[lv.id];
      return `<button class="level-card ${unlocked ? '' : 'locked'}" data-index="${i}" ${unlocked ? '' : 'disabled'}>
        <span class="lnum">${unlocked ? lv.id : '🔒'}</span>
        <span class="lbody">
          <span class="lname">${lv.name} · ${lv.waveCount} 波</span>
          <span class="ldesc">${lv.desc}</span>
          ${b ? `<span class="lbest">最高分 ${b.score} · 最远第 ${b.wave} 波</span>` : `<span class="lbest">${unlocked ? '尚未通关' : '通关上一关后解锁'}</span>`}
        </span>
      </button>`;
    }).join('')}</div>`;

    this.showDialog({
      title: '选择关卡',
      sub: '关卡难度递增，通关后解锁下一关。',
      body,
      actions: [
        { label: '操作说明', fn: () => this.showHelp() },
        { label: '关闭', fn: () => this.hideDialog() }
      ]
    });

    this.el.dlgBody.querySelectorAll('.level-card').forEach((card) => {
      card.addEventListener('click', () => {
        if (card.disabled) return;
        this.app.audio.click();
        this.app.startLevel(Number(card.dataset.index));
      });
    });
  }

  showHelp() {
    this.showDialog({
      title: '怎么玩',
      sub: '目标：让敌人一路走到你的城堡，别让它得逞。',
      body: `<div class="muted" style="text-align:left">
        1. 底部选一种防御塔，再点地图上的空地就能建造。<br>
        2. 点已建造的塔可以升级、出售、切换攻击优先级。<br>
        3. 点顶部「第N波」可提前召唤下一波，越早按奖励金币越多。<br>
        4. 红色小兵血少，重甲有护甲（用冰/电/毒这些无视护甲的塔），飞行单位会走直线抄近路。<br>
        5. 减速塔 + 高输出塔是通用解法；毒塔打首领最划算。<br>
        6. 顶部 1× 按钮可切换 2×/3× 加速，暂停会自动存进度。
      </div>`,
      actions: [
        { label: '返回选关', fn: () => this.showLevelSelect() },
        { label: '开始游戏', cls: 'primary', fn: () => this.hideDialog() }
      ]
    });
  }

  // ---------------- 横屏提示 ----------------
  showRotateHint() {
    reveal(this.el.rotate);
    document.querySelector('#btn-rotate-ok').onclick = () => {
      this.el.rotate.classList.add('hidden');
      this.app.save.rotateHintShown = true;
      this.app.persist();
    };
  }

  hideRotateHint() {
    this.el.rotate.classList.add('hidden');
  }
}
