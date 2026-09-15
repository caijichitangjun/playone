/**
 * 输入层：把指针/触摸事件翻译成游戏意图。
 * 统一用 Pointer Events，Android / iOS / 桌面共用一套逻辑。
 * 触控规则：
 *   - 选了塔型 → 点空地建造（建造后保持选中，方便连续摆塔）
 *   - 没选塔型 → 点塔看详情；点空地取消选中
 */
import { TILE } from './config.js';
import { screenToWorld } from './render.js';

export function attachInput(canvas, app) {
  const localPoint = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const tileOf = (ev) => {
    const p = localPoint(ev);
    const w = screenToWorld(app.view, p.x, p.y);
    const cx = Math.floor(w.x / TILE);
    const cy = Math.floor(w.y / TILE);
    return { cx, cy, wx: w.x, wy: w.y, inside: cx >= 0 && cy >= 0 };
  };

  const handleTap = (ev) => {
    if (app.ui.dialogOpen || app.paused) return;
    const t = tileOf(ev);
    if (!t.inside) return;

    if (app.buildKey) {
      const tower = app.game.towerAt(t.cx, t.cy);
      if (tower) {
        // 点到已建成的塔：进入详情，而不是报错
        app.setBuildKey(null);
        app.ui.showPanel(app.game, tower);
        return;
      }
      const res = app.game.build(app.buildKey, t.cx, t.cy);
      if (!res.ok) {
        if (res.reason === 'gold') app.ui.toast('金币不足，攒够再来', 'bad');
        else if (res.reason === 'tile') app.ui.toast('这里不能建造', 'bad');
        app.audio.deny();
        return;
      }
      app.ui.updateDock(app.game);
      return;
    }

    const tower = app.game.towerAt(t.cx, t.cy);
    if (tower) app.ui.showPanel(app.game, tower);
    else app.ui.hidePanel();
  };

  canvas.addEventListener('pointerdown', (ev) => {
    app.audio.unlock();
    if (ev.pointerType === 'mouse') {
      const t = tileOf(ev);
      app.hover = { cx: t.cx, cy: t.cy };
      return; // 鼠标等 pointerup 再确认，避免误触
    }
    handleTap(ev);
  });

  canvas.addEventListener('pointerup', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    if (ev.button !== 0) return;
    handleTap(ev);
  });

  canvas.addEventListener('pointermove', (ev) => {
    const t = tileOf(ev);
    if (ev.pointerType === 'mouse') {
      app.hover = { cx: t.cx, cy: t.cy };
    } else if (app.buildKey) {
      // 触屏拖动时也给出落点预览
      app.hover = { cx: t.cx, cy: t.cy };
    }
  });

  canvas.addEventListener('pointerleave', () => {
    app.hover = null;
  });

  canvas.addEventListener('pointercancel', () => {
    app.hover = null;
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // 桌面端快捷键，方便调试与快速操作
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      app.manualNextWave();
    } else if (ev.code === 'KeyP') {
      app.togglePause();
    } else if (ev.code === 'Escape') {
      if (app.ui.dialogOpen) {
        app.ui.hideDialog();
        app.paused = false;
      } else if (app.buildKey) {
        app.setBuildKey(null);
      } else {
        app.ui.hidePanel();
      }
    } else if (/^Digit[1-5]$/.test(ev.code)) {
      const idx = Number(ev.code.slice(5)) - 1;
      app.selectTowerByIndex(idx);
    }
  });
}
