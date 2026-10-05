/* =============================================================
   app.js — 启动、路由、侧边导航与全局设置
   -------------------------------------------------------------
   路由使用 hash：#/coin、#/dice …（默认 #/coin）
   ============================================================= */
(function (global) {
  'use strict';

  const App = global.App;
  const ui = App.ui;
  const el = ui.el;
  const doc = global.document;

  const viewEl = doc.getElementById('view');
  const navEl = doc.getElementById('navList');
  let current = null;        // 当前功能
  let cleanup = null;        // 上一个视图的清理函数
  let settings = App.store.getSettings();

  /* ---------------------------------------------------------
     全局上下文：传给每个功能的 mount(root, ctx)
     --------------------------------------------------------- */
  const ctx = {
    go: function (id) { global.location.hash = '#/' + id; },
    currentId: function () { return current ? current.id : null; },
    isActive: function () { return current ? current.id === routeId() : false; },
    toast: ui.toast,
    settings: settings,
    /** 未来功能可以把操作按钮注册到全局动作区（暂未渲染区域） */
    setActions: function () {}
  };

  /* ---------------------------------------------------------
     侧边导航
     --------------------------------------------------------- */
  function buildNav() {
    ui.clear(navEl);
    App.modes.list.forEach(function (mode) {
      const card = el('button.mode-card', {
        type: 'button',
        disabled: !mode.available,
        'aria-current': 'false',
        dataset: { mode: mode.id },
        onclick: function () {
          if (!mode.available) {
            ui.toast('「' + mode.name + '」还在规划中，敬请期待');
            return;
          }
          ctx.go(mode.id);
        }
      }, [
        el('span.mode-card__icon', { text: mode.icon }),
        el('span.mode-card__body', [
          el('span.mode-card__name', { text: mode.name }),
          el('span.mode-card__desc', { text: mode.desc })
        ]),
        mode.available ? null : el('span.mode-card__soon', { text: '待开发' })
      ]);
      navEl.appendChild(card);
    });
  }

  function highlightNav(id) {
    Array.prototype.forEach.call(navEl.querySelectorAll('.mode-card'), function (card) {
      card.setAttribute('aria-current', card.dataset.mode === id ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------
     路由
     --------------------------------------------------------- */
  function routeId() {
    const raw = (global.location.hash || '').replace(/^#\/?/, '').trim();
    const id = raw.split('?')[0].split('/')[0];
    return id || App.modes.defaultId;
  }

  function render() {
    let id = routeId();
    let mode = App.modes.get(id);
    if (!mode || !mode.available) {
      if (id !== App.modes.defaultId) {
        ui.toast('没有找到该功能，已回到抛硬币');
      }
      id = App.modes.defaultId;
      mode = App.modes.get(id);
      global.location.replace('#/' + id);
    }

    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    ui.clear(viewEl);
    current = mode;
    highlightNav(mode.id);
    doc.title = 'ChOIceN · ' + mode.name;
    cleanup = mode.mount(viewEl, ctx) || null;
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------
     顶部栏：音效开关
     --------------------------------------------------------- */
  function initSound() {
    const btn = doc.getElementById('soundToggle');
    const icon = doc.getElementById('soundIcon');
    const label = btn.querySelector('.icon-btn__text');

    function sync() {
      const on = !!settings.sound;
      App.audio.setMuted(!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      icon.textContent = on ? '🔊' : '🔇';
      if (label) label.textContent = on ? '音效开' : '音效关';
    }

    btn.addEventListener('click', function () {
      settings.sound = !settings.sound;
      App.store.setSetting('sound', settings.sound);
      if (settings.sound) App.audio.unlock();
      sync();
      ui.toast(settings.sound ? '音效已开启' : '音效已关闭');
    });

    // 首次交互解锁音频（浏览器自动播放策略）
    const unlock = function () { App.audio.unlock(); doc.removeEventListener('pointerdown', unlock); };
    doc.addEventListener('pointerdown', unlock);

    sync();
  }

  /* ---------------------------------------------------------
     顶部栏：清空统计
     --------------------------------------------------------- */
  function initReset() {
    doc.getElementById('resetStats').addEventListener('click', function () {
      if (!global.confirm('确定清空全部抛掷统计与历史记录吗？此操作不可撤销。')) return;
      App.store.resetStats();
      App.rng.reseed();
      render();
      ui.toast('统计与历史已清空');
    });
  }

  /* ---------------------------------------------------------
     键盘：数字键快速切换功能
     --------------------------------------------------------- */
  function initShortcuts() {
    doc.addEventListener('keydown', function (e) {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const index = parseInt(e.key, 10);
      if (!index || index < 1 || index > App.modes.list.length) return;
      const mode = App.modes.list[index - 1];
      e.preventDefault();
      if (mode.available) ctx.go(mode.id);
      else ui.toast('「' + mode.name + '」还在规划中');
    });
  }

  /* ---------------------------------------------------------
     启动
     --------------------------------------------------------- */
  function boot() {
    buildNav();
    initSound();
    initReset();
    initShortcuts();
    App.rng.reseed();
    // 预留一次初始熵，让「随机源」面板首次渲染就有真实数据（此时还没有抛掷）
    App.rng.float();
    global.addEventListener('hashchange', render);
    if (!global.location.hash) global.location.replace('#/' + App.modes.defaultId);
    render();
    console.log('%cChOIceN','color:#f2c75c;font-weight:700',
      '已就绪 · 随机源：时间熵 + xorshift64* · 通过 App.modes.list 注册新功能');
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
