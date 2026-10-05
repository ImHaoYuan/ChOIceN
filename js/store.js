/* =============================================================
   store.js — 轻量本地存储（统计 / 历史 / 偏好设置）
   数据存在 localStorage，以 choisence.v1.* 为前缀，
   未来新增功能可继续沿用 App.store 的命名空间。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});
  const PREFIX = 'choicen.v1.';
  const HISTORY_LIMIT = 60;

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function read(key, fallback) {
    try {
      const raw = global.localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      const val = safeParse(raw);
      return val === null ? fallback : val;
    } catch (e) {
      return fallback;   // 隐私模式等场景下静默退化
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const DEFAULT_STATS = { heads: 0, tails: 0, total: 0, lastAt: 0 };

  const DEFAULT_SETTINGS = {
    sound: true,          // 音效
    slowMotion: false,    // 慢动作（1.8×）
    showEntropy: true     // 显示随机源诊断面板
  };

  App.store = {
    keys: { stats: 'stats', history: 'history', settings: 'settings' },

    /* ---- 抛硬币统计 ---- */
    getStats() {
      const s = read('stats', null);
      if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_STATS);
      return Object.assign({}, DEFAULT_STATS, {
        heads: Number(s.heads) || 0,
        tails: Number(s.tails) || 0,
        total: Number(s.total) || 0,
        lastAt: Number(s.lastAt) || 0
      });
    },

    /** 记录一次结果，返回新的统计对象 */
    record(result) {
      const s = this.getStats();
      if (result === 'heads') s.heads++;
      else if (result === 'tails') s.tails++;
      s.total = s.heads + s.tails;
      s.lastAt = Date.now();
      write('stats', s);
      return s;
    },

    resetStats() {
      write('stats', Object.assign({}, DEFAULT_STATS));
      write('history', []);
      return this.getStats();
    },

    /* ---- 历史记录（最新在前，最多 HISTORY_LIMIT 条） ---- */
    getHistory() {
      const h = read('history', []);
      return Array.isArray(h) ? h : [];
    },

    pushHistory(entry) {
      const h = this.getHistory();
      h.unshift(entry);
      if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT;
      write('history', h);
      return h;
    },

    /* ---- 偏好设置 ---- */
    getSettings() {
      const s = read('settings', null);
      if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS, s);
    },

    setSetting(key, value) {
      const s = this.getSettings();
      s[key] = value;
      write('settings', s);
      return s;
    },

    /** 供未来功能使用的通用读写接口 */
    read, write
  };
})(window);
