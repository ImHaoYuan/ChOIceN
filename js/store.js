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

  /*
   * 掷骰子的统计形状与抛硬币完全不同（一次掷多颗、还要看点数分布），
   * 所以单独一个键，用 recordDice / getDiceStats 这组接口，不去动上面那套。
   *   rolls  掷了多少次（一次可含多颗骰子）
   *   dice   累计掷出多少颗骰子
   *   sum    累计点数之和
   *   dist   点数分布，按面数分桶：{ "6": { "1": 12, ... }, "20": {...} }
   *          分桶是必须的 —— 换成 d20 之后，d6 时代的点数分布口径就变了，
   *          混在一个桶里画出来的图没有意义。
   */
  const DEFAULT_DICE_STATS = {
    rolls: 0, dice: 0, sum: 0, lastSum: 0, lastAt: 0, faces: 6, dist: {}
  };

  const DEFAULT_SETTINGS = {
    sound: true,          // 音效
    slowMotion: false,    // 慢动作（1.8×）
    showEntropy: true,    // 显示随机源诊断面板
    theme: 'auto',        // 主题：auto（按时间）/ light / dark
    rngSource: 'hybrid'   // 随机源：hybrid（混合）/ crypto（加密）/ time（时间）
  };

  App.store = {
    keys: {
      stats: 'stats',
      history: 'history',
      settings: 'settings',
      diceStats: 'diceStats',
      diceHistory: 'diceHistory'
    },

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

    /* ---- 掷骰子统计（与抛硬币分开存，互不影响） ---- */
    getDiceStats() {
      const s = read('diceStats', null);
      if (!s || typeof s !== 'object') return Object.assign({}, DEFAULT_DICE_STATS, { dist: {} });
      return {
        rolls: Number(s.rolls) || 0,
        dice: Number(s.dice) || 0,
        sum: Number(s.sum) || 0,
        lastSum: Number(s.lastSum) || 0,
        lastAt: Number(s.lastAt) || 0,
        faces: Number(s.faces) || 6,
        dist: (s.dist && typeof s.dist === 'object' && !Array.isArray(s.dist)) ? s.dist : {}
      };
    },

    /**
     * 记录一次掷骰。
     * @param {number[]} values 本次每颗骰子的点数
     * @param {number} faces    本次用的面数（点数分布按它分桶）
     * @returns {object} 新的统计对象
     */
    recordDice(values, faces) {
      const list = Array.isArray(values) ? values : [];
      const s = this.getDiceStats();
      const f = Number(faces) || s.faces || 6;
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += Number(list[i]) || 0;

      s.rolls += 1;
      s.dice += list.length;
      s.sum += sum;
      s.lastSum = sum;
      s.lastAt = Date.now();
      s.faces = f;

      const key = String(f);
      const bucket = Object.assign({}, s.dist[key] || {});
      list.forEach(function (v) {
        const k = String(v);
        bucket[k] = (Number(bucket[k]) || 0) + 1;
      });
      s.dist[key] = bucket;

      write('diceStats', s);
      return s;
    },

    resetDiceStats() {
      write('diceStats', Object.assign({}, DEFAULT_DICE_STATS, { dist: {} }));
      write('diceHistory', []);
      return this.getDiceStats();
    },

    /* ---- 掷骰子历史（最新在前，最多 HISTORY_LIMIT 条） ---- */
    getDiceHistory() {
      const h = read('diceHistory', []);
      return Array.isArray(h) ? h : [];
    },

    pushDiceHistory(entry) {
      const h = this.getDiceHistory();
      h.unshift(entry);
      if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT;
      write('diceHistory', h);
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
