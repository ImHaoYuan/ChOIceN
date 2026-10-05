/* =============================================================
   theme.js — 深色 / 浅色主题
   -------------------------------------------------------------
   三种模式：
     auto  跟随时间（默认）—— 本地时间 08:00–17:59 用浅色，其余用深色
     light 始终浅色
     dark  始终深色
   · 结果写到 <html data-theme="light|dark">，CSS 变量按这个属性切换
   · 模式存在 localStorage（choicen.v1.settings.theme），与其它偏好一致
   · auto 模式运行期间会跨过 8 点 / 18 点自动切换（每 60 秒检查一次）
   · index.html <head> 里有一段同样规则的内联脚本，用于首屏防闪，
     改动时间规则时两处都要改（内联脚本不能引用外部文件）
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});
  const doc = global.document;
  const DARK = 'dark';
  const LIGHT = 'light';
  const MODES = ['auto', 'light', 'dark'];

  let mode = 'auto';
  let current = DARK;
  let timer = 0;
  const listeners = [];

  /** 按本地时间判断应该用哪套主题：08:00–17:59 → 浅色 */
  function themeByTime(date) {
    const h = (date || new Date()).getHours();
    return (h >= 8 && h < 18) ? LIGHT : DARK;
  }

  function normalize(value) {
    return MODES.indexOf(value) > -1 ? value : 'auto';
  }

  function resolve(value) {
    const m = normalize(value);
    if (m === LIGHT || m === DARK) return m;
    return themeByTime(new Date());
  }

  function paint(theme) {
    doc.documentElement.setAttribute('data-theme', theme);
    // 让浏览器原生控件（滚动条、输入框）也跟着换
    doc.documentElement.style.colorScheme = theme;
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(current, mode); } catch (e) { /* 单个回调出错不影响其它 */ }
    });
  }

  /** 应用主题；传 mode 则同时切换模式 */
  function apply(nextMode) {
    if (nextMode != null) mode = normalize(nextMode);
    const resolved = resolve(mode);
    // 即使结果没变也要写一次属性，保证首屏内联脚本的结果与这里一致
    paint(resolved);
    if (resolved !== current) {
      current = resolved;
      notify();
    }
    return current;
  }

  /** auto 模式下跨过 8:00 / 18:00 时自动切换 */
  function tick() {
    if (mode !== 'auto') return;
    const resolved = themeByTime(new Date());
    if (resolved !== current) {
      current = resolved;
      paint(resolved);
      notify();
    }
  }

  /** 系统主题变化时不介入：本方案的 auto 完全以本地时间为准 */

  App.theme = {
    MODES: MODES,
    themeByTime: themeByTime,
    resolve: resolve,
    getMode: function () { return mode; },
    get: function () { return current; },

    /** 初始化：从偏好读取模式并应用（app.js 在启动时调用） */
    init: function (savedMode) {
      mode = normalize(savedMode);
      apply();
      if (timer) global.clearInterval(timer);
      timer = global.setInterval(tick, 60000);
      return current;
    },

    /** 手动切换模式并返回新主题 */
    setMode: function (nextMode) {
      apply(nextMode);
      if (App.store && App.store.setSetting) App.store.setSetting('theme', mode);
      return current;
    },

    /** 循环切换：auto → light → dark → auto */
    toggle: function () {
      const i = MODES.indexOf(mode);
      return this.setMode(MODES[(i + 1) % MODES.length]);
    },

    /** 订阅主题变化（返回取消订阅函数） */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    /** 给界面用的文案 */
    label: function (value) {
      const m = normalize(value == null ? mode : value);
      if (m === LIGHT) return { name: '浅色', icon: '☀️', hint: '始终浅色' };
      if (m === DARK) return { name: '深色', icon: '🌙', hint: '始终深色' };
      return { name: '跟随时间', icon: '⏱️', hint: '8:00–18:00 浅色，其余深色' };
    }
  };
})(window);
