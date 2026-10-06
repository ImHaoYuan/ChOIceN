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

  /** 主题按钮的文案：模式名 + 当前实际生效的外观 */
  function themeLabel(modeValue) {
    const info = App.theme.label(modeValue == null ? App.theme.getMode() : modeValue);
    const resolved = App.theme.get() === 'light' ? '浅色' : '深色';
    return info.name + ' · 当前' + resolved;
  }

  /**
   * 创建主题按钮。顶部栏与设置面板各一个，共用同一套逻辑；
   * data-mode 用于让 CSS 在模式变化时重放一次强调动画。
   */
  function createThemeButton(extraClass) {
    const btn = el('button', {
      type: 'button',
      class: 'icon-btn theme-btn' + (extraClass ? ' ' + extraClass : ''),
      title: '主题：跟随时间 / 浅色 / 深色（点按循环切换）',
      'aria-label': '切换主题'
    }, [
      el('span.icon-btn__icon', { 'aria-hidden': 'true' }),
      el('span.icon-btn__text')
    ]);
    return btn;
  }

  function syncThemeButton(btn) {
    const mode = App.theme.getMode();
    const info = App.theme.label(mode);
    btn.dataset.mode = mode;
    btn.querySelector('.icon-btn__icon').textContent = info.icon;
    btn.querySelector('.icon-btn__text').textContent = info.name;
    btn.title = '主题：' + info.name + '（' + info.hint + '）· 当前' +
      (App.theme.get() === 'light' ? '浅色' : '深色');
    // 每次切换都重放一次动画（先清空再设置，强制重新触发）
    delete btn.dataset.changed;
    void btn.offsetWidth;
    btn.dataset.changed = mode;
  }

  const themeButtons = [];

  function registerThemeButton(btn) {
    btn.addEventListener('click', function () {
      const next = App.theme.toggle();
      App.ui.toast('主题：' + App.theme.label().name + '（当前' +
        (next === 'light' ? '浅色' : '深色') + '）');
    });
    themeButtons.push(btn);
    syncThemeButton(btn);
    return btn;
  }

  function refreshThemeButtons() {
    themeButtons.forEach(syncThemeButton);
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', App.theme.get() === 'light' ? '#f2f4f9' : '#0b0f1a');
  }

  /** 一个可直接放进任意界面的主题按钮（供各功能视图复用） */
  function createThemeControl() {
    return registerThemeButton(createThemeButton('theme-btn--inline'));
  }

  /* ---------------------------------------------------------
     偏好变更广播
     ---------------------------------------------------------
     顶部栏现在承载了「慢动作 / 显示随机源」这些开关，
     但它们影响的是当前视图里的东西（硬币速度、随机源面板显隐），
     所以改完要广播出去，由视图自己响应，而不是让顶部栏去操作视图内部。
  */
  const settingListeners = [];

  function onSettingChange(fn) {
    settingListeners.push(fn);
    return function () {
      const i = settingListeners.indexOf(fn);
      if (i > -1) settingListeners.splice(i, 1);
    };
  }

  function applySetting(key, value) {
    settings[key] = value;
    App.store.setSetting(key, value);
    settingListeners.slice().forEach(function (fn) {
      try { fn(key, value); } catch (e) { /* 单个订阅者出错不影响其它人 */ }
    });
  }

  /** 清空统计按钮（顶部栏那个）。抛硬币与掷骰子的记录一起清掉 —— 按钮写的是「全部」。 */
  function resetStatsNow() {
    if (!global.confirm('确定清空全部统计与历史记录（抛硬币 + 掷骰子）吗？此操作不可撤销。')) return;
    App.store.resetStats();
    App.store.resetDiceStats();
    App.rng.reseed();
    render();
    ui.toast('统计与历史已清空');
  }

  /* ---------------------------------------------------------
     全局上下文：传给每个功能的 mount(root, ctx)
     --------------------------------------------------------- */
  const ctx = {
    go: function (id) { global.location.hash = '#/' + id; },
    currentId: function () { return current ? current.id : null; },
    isActive: function () { return current ? current.id === routeId() : false; },
    toast: ui.toast,
    settings: settings,
    /** 各功能可复用顶部栏同款的主题切换控件 */
    themeControl: createThemeControl,
    /** 各功能若自建了「清空统计」入口，直接调用它 */
    resetStats: resetStatsNow,
    /** 订阅偏好变化（返回取消订阅函数）；顶部栏的开关改动会广播给当前视图 */
    onSetting: onSettingChange,
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
     顶部栏：主题切换（跟随时间 / 浅色 / 深色）
     --------------------------------------------------------- */
  function initTheme() {
    // 由偏好决定：auto（按时间）/ light / dark
    // URL 上的 ?theme=light|dark|auto 作为临时覆盖（写入 hash 之前也生效），
    // 方便直接打开某个外观，且不会改动已保存的偏好。
    const forced = /[?&]theme=(light|dark|auto)\b/.exec(global.location.search || '');
    App.theme.init(forced ? forced[1] : settings.theme);
    // 顶部栏按钮已写在 index.html 里，直接复用同一套渲染逻辑
    const top = doc.getElementById('themeToggle');
    if (top && themeButtons.indexOf(top) === -1) registerThemeButton(top);
    // 主题变化时同步所有主题按钮与浏览器地址栏配色
    App.theme.onChange(refreshThemeButtons);
    refreshThemeButtons();
  }

  /* ---------------------------------------------------------
     顶部栏：随机源（点按循环 混合 → 加密 → 时间）
     --------------------------------------------------------- */
  function initSource() {
    const btn = doc.getElementById('sourceToggle');
    const nameEl = doc.getElementById('sourceName');
    const iconEl = doc.getElementById('sourceIcon');
    if (!btn || !nameEl || !iconEl) return;

    function sync() {
      const key = App.rng.getSource();
      const label = App.rng.sourceLabel(key);
      nameEl.textContent = label.name;
      if (label.icon) iconEl.textContent = label.icon;
      btn.dataset.source = key;
      btn.title = '随机源：' + label.name + '（' + label.desc + '）· 点按循环切换';
    }

    btn.addEventListener('click', function () {
      const next = App.rng.cycle();
      App.store.setSetting('rngSource', next);
      ui.toast('随机源已切换为「' + App.rng.sourceLabel(next).name + '」' +
        (App.rng.hasCrypto ? '' : '（当前环境不支持 crypto）'));
    });

    App.rng.onChange(sync);
    sync();
  }

  /* ---------------------------------------------------------
     顶部栏：更多选项（下拉列表里放次要开关）
     --------------------------------------------------------- */
  function initMoreMenu() {
    const wrap = doc.getElementById('moreMenu');
    const btn = doc.getElementById('moreToggle');
    const panel = doc.getElementById('morePanel');
    if (!wrap || !btn || !panel) return;

    // 两个开关复用 ui.switchControl；改完通过 applySetting 广播给当前视图
    const swSlow = ui.switchControl('慢动作', settings.slowMotion, function (on) {
      applySetting('slowMotion', on);
      ui.toast(on ? '慢动作已开启（动画 1.8×）' : '慢动作已关闭');
    });
    const swEntropy = ui.switchControl('显示随机源', settings.showEntropy, function (on) {
      applySetting('showEntropy', on);
    });

    panel.appendChild(el('p.menu__title', { text: '更多选项' }));
    panel.appendChild(el('div.menu__list', [swSlow, swEntropy]));

    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      wrap.classList.toggle('menu--open', open);
    }

    btn.addEventListener('click', function (e) {
      // 阻止冒泡，否则会被下面的「点空白处关闭」立刻关掉
      if (e && e.stopPropagation) e.stopPropagation();
      setOpen(panel.hidden);
    });
    // 点面板内部（拨动开关）不关闭
    panel.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
    });
    // 点页面其它地方、或按 Esc 关闭
    doc.addEventListener('click', function () { if (!panel.hidden) setOpen(false); });
    doc.addEventListener('keydown', function (e) {
      if (panel.hidden) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        setOpen(false);
        btn.focus();
      }
    });

    setOpen(false);
  }

  /* ---------------------------------------------------------
     顶部栏：清空统计
     --------------------------------------------------------- */
  function initReset() {
    doc.getElementById('resetStats').addEventListener('click', resetStatsNow);
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
    // 先定随机源：后续所有取值（含首屏那次预热）都要用它
    App.rng.setSource(settings.rngSource);
    buildNav();
    initTheme();
    initSource();
    initMoreMenu();
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
      '已就绪 · 随机源：' + App.rng.sourceLabel().name +
      '（' + App.rng.sourceLabel().desc + '）· 通过 App.modes.list 注册新功能');
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
