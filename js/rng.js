/* =============================================================
   rng.js — 随机源（时间熵 / 系统加密随机 / 两者混合）
   -------------------------------------------------------------
   三种随机源，可在界面上切换：

     hybrid（默认）  时间熵 + 系统加密随机 一起混入 64 位状态池
     crypto         直接用 crypto.getRandomValues（系统熵，CSPRNG）
     time           仅用本地时间熵（老行为，不依赖 crypto）

   关于「真随机」的说明（重要，别被网上说法带偏）：
     1. 网页里**无法**直接访问硬件真随机发生器（TRNG），浏览器不暴露该接口；
     2. crypto.getRandomValues 由操作系统熵池播种（Windows 的 BCryptGenRandom、
        Linux 的 getrandom），是不可预测的密码学安全伪随机数发生器（CSPRNG），
        也是浏览器给密钥、nonce 用的同一个来源。它是网页能拿到的最接近
        「真随机」的东西；
     3. 因此本模块把它标为「系统加密随机」而不是「真随机」，
        不给人错误的期待。需要绝对随机（如抽奖公证）应使用外部硬件或服务。

   时间熵的采集与混合：
     毫秒时间戳 + 高精度计时（含小数）+ 与上次调用的间隔 + 调用序号
     → FNV-1a 变体逐项混入 64 位状态池 → xorshift64* → 雪崩 → 32 位输出
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  const U32 = 0x100000000;             // 2^32
  const TWO_POW_26 = 67108864;         // 2^26
  const TWO_POW_53 = 9007199254740992; // 2^53
  const HIGH_INIT = 0x9e3779b9;

  const cryptoObj = (global.crypto && typeof global.crypto.getRandomValues === 'function')
    ? global.crypto
    : null;
  const HAS_CRYPTO = !!cryptoObj;

  const SOURCES = ['hybrid', 'crypto', 'time'];
  const SOURCE_LABEL = {
    hybrid: { name: '混合', icon: '🔀', desc: '时间熵 + 系统加密随机（默认）' },
    crypto: { name: '加密', icon: '🔐', desc: 'crypto.getRandomValues，操作系统熵 CSPRNG' },
    time: { name: '时间', icon: '🕒', desc: '仅本地时间熵，不依赖 crypto' }
  };

  /* 状态池与诊断信息 */
  const S = {
    hi: HIGH_INIT,
    lo: 0x85ebca6b,
    calls: 0,          // 池内调用数
    lastTime: 0,
    lastDelta: 0,
    lastRaw: 0,
    lastBits: 0,
    lastSource: 'time',
    lastCrypto: 0,     // 最近一次取到的系统随机数
    cryptoWords: 0     // 累计取了多少个 32 位系统随机数
  };

  let source = 'hybrid';
  const listeners = [];

  function nowMs() { return Date.now(); }

  function perfNow() {
    return (global.performance && typeof global.performance.now === 'function')
      ? global.performance.now()
      : 0;
  }

  /* ---- FNV-1a 变体：把一个 32 位值混入 64 位状态 ---- */
  function mix32(hi, lo, v) {
    let h = (hi ^ (v | 0)) >>> 0;
    let l = (lo ^ Math.imul(v | 0, 0x01000193)) >>> 0;   // FNV prime
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;     // murmur 常量
    l = Math.imul(l ^ (l >>> 13), 0xc2b2ae35) >>> 0;
    h = (h + (l >>> 7)) >>> 0;
    l = (l + (h >>> 11)) >>> 0;
    return [h >>> 0, l >>> 0];
  }

  /* ---- xorshift64*：推进状态并返回新的状态与原始输出 ---- */
  function xorshift64star(hi, lo) {
    let x = hi >>> 0;
    let y = lo >>> 0;
    x ^= (x << 13) >>> 0; x >>>= 0;
    x ^= (x >>> 7) >>> 0; x >>>= 0;
    x ^= (y << 17) >>> 0; x >>>= 0;
    y = (y ^ (y >>> 11)) >>> 0;
    return [x >>> 0, y >>> 0, Math.imul(x, 0x2545f491) >>> 0];
  }

  /* ---- 采集时间熵（顺带刷新诊断字段）---- */
  function touchTime() {
    const t = nowMs();
    const p = perfNow();
    const delta = Math.max(0, t - S.lastTime);
    S.lastTime = t;
    S.lastDelta = delta;
    S.calls = (S.calls + 1) >>> 0;
    return { t: t, p: p, delta: delta };
  }

  /**
   * 时间熵产出 32 位。
   * @param {number[]|null} extra 额外混入的 32 位量（混合模式用来混 crypto）
   */
  function timeBits(extra) {
    const tm = touchTime();
    let hi = S.hi;
    let lo = S.lo;
    let pair;

    pair = mix32(hi, lo, tm.t);                        hi = pair[0]; lo = pair[1];
    pair = mix32(hi, lo, Math.floor(tm.p));            hi = pair[0]; lo = pair[1];
    pair = mix32(hi, lo, Math.floor((tm.p % 1) * 1e6)); hi = pair[0]; lo = pair[1];
    pair = mix32(hi, lo, tm.delta);                    hi = pair[0]; lo = pair[1];
    pair = mix32(hi, lo, S.calls);                     hi = pair[0]; lo = pair[1];
    if (extra) {
      for (let i = 0; i < extra.length; i++) {
        pair = mix32(hi, lo, extra[i] | 0);
        hi = pair[0];
        lo = pair[1];
      }
    }

    const out = xorshift64star(hi, lo);
    S.hi = out[0];
    S.lo = out[1];

    // 雪崩：任意一位的变化都要扩散到整个字
    let bits = (out[2] ^ out[0] ^ out[1]) >>> 0;
    bits ^= bits >>> 16;
    bits = Math.imul(bits, 0x7feb352d) >>> 0;
    bits ^= bits >>> 15;
    bits = Math.imul(bits, 0x846ca68b) >>> 0;
    // 注意：最后一步必须做一次右移异或，且不能是 >>> 31。
    // 若写成 bits ^= bits >>> 31，最低位会被异或成恒 0，
    // 而 side() 正是取最低位，会导致「永远正面」。
    bits ^= bits >>> 16;

    S.lastRaw = out[2] >>> 0;
    S.lastBits = bits >>> 0;
    return S.lastBits;
  }

  /* ---- 取 n 个 32 位系统随机数 ---- */
  function cryptoWords(n) {
    const arr = new Uint32Array(n);
    cryptoObj.getRandomValues(arr);
    S.cryptoWords += n;
    return arr;
  }

  /* ---- 按当前随机源产出一个 32 位无符号整数 ---- */
  function uint32() {
    if (HAS_CRYPTO && source === 'crypto') {
      const w = cryptoWords(1);
      touchTime();                 // 让诊断面板的时间字段仍然有意义
      const pair = mix32(S.hi, S.lo, w[0]);
      S.hi = pair[0];
      S.lo = pair[1];
      S.lastCrypto = w[0];
      S.lastSource = 'crypto';
      S.lastRaw = w[0];
      S.lastBits = w[0];
      return w[0];
    }
    if (HAS_CRYPTO && source === 'hybrid') {
      const w = cryptoWords(2);
      S.lastCrypto = w[0];
      S.lastSource = 'hybrid';
      return timeBits([w[0], w[1]]);
    }
    // time 源；或请求了 crypto 但当前环境没有，自动降级
    S.lastSource = 'time';
    return timeBits(null);
  }

  /* ---- 源名规范化：没有 crypto 时一律降级为 time ---- */
  function normalizeSource(name) {
    const want = SOURCES.indexOf(name) === -1 ? 'hybrid' : name;
    if (!HAS_CRYPTO && want !== 'time') return 'time';
    return want;
  }

  function notify() {
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](source); } catch (e) { /* 单个订阅者出错不影响其它人 */ }
    }
  }

  /* ---- 公开接口 ---- */
  App.rng = {
    SOURCES: SOURCES,
    SOURCE_LABEL: SOURCE_LABEL,
    hasCrypto: HAS_CRYPTO,

    /** 切换随机源，返回实际生效的源名 */
    setSource: function (name) {
      source = normalizeSource(name);
      notify();
      return source;
    },
    getSource: function () { return source; },
    normalizeSource: normalizeSource,

    /**
     * 循环切换：混合 → 加密 → 时间 → 混合（顶部栏按钮用）。
     * 只在本环境可用的源之间循环：没有 crypto 时可用源只有 time，
     * 这时点击不会有任何变化，而不是切到一个假的「加密」。
     */
    cycle: function () {
      const usable = SOURCES.filter(function (n) { return normalizeSource(n) === n; });
      const i = usable.indexOf(source);
      return this.setSource(usable[(i + 1) % usable.length]);
    },

    /** 给界面用的文案：{ name, desc } */
    sourceLabel: function (value) {
      const key = normalizeSource(value == null ? source : value);
      return SOURCE_LABEL[key];
    },

    /** [0, 1) 均匀随机数，53 位精度 */
    float: function () {
      const hi = uint32() >>> 5;   // 27 位
      const lo = uint32() >>> 6;   // 26 位
      return (hi * TWO_POW_26 + lo) / TWO_POW_53;
    },

    /** [0, max) 整数：用拒绝采样消除取模偏差 */
    int: function (max) {
      const range = Math.floor(max);
      if (!isFinite(range) || range <= 0) return 0;
      if (range === 1) return 0;
      if (range > U32) return Math.floor(this.float() * range);
      const limit = U32 - (U32 % range);
      let v = uint32();
      let guard = 0;
      while (v >= limit && guard++ < 64) v = uint32();
      return v % range;
    },

    /** 由随机位决定正/反面：0 = 正面(heads)，1 = 反面(tails) */
    side: function () {
      return (uint32() & 1) === 0 ? 'heads' : 'tails';
    },

    /** 抽样 n 个 [0,1) 浮点数（展示熵用） */
    bytes: function (n) {
      const out = [];
      for (let i = 0; i < (n || 0); i++) out.push(this.float());
      return out;
    },

    /** 诊断信息：给界面展示「随机是怎么来的」 */
    info: function () {
      return {
        time: S.lastTime,
        delta: S.lastDelta,
        calls: S.calls,
        raw: S.lastRaw >>> 0,
        bits: (S.lastBits >>> 0).toString(2).padStart(32, '0'),
        pool: ((S.hi >>> 0).toString(16).padStart(8, '0') +
               (S.lo >>> 0).toString(16).padStart(8, '0')),
        source: S.lastSource,
        crypto: S.lastCrypto >>> 0,
        cryptoWords: S.cryptoWords,
        hasCrypto: HAS_CRYPTO
      };
    },

    /** 订阅随机源切换（返回取消订阅函数） */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    /** 重置状态池与时间基准（清空统计时调用，避免旧状态残留） */
    reseed: function () {
      const seed = nowMs();
      S.hi = (HIGH_INIT ^ (seed >>> 0)) >>> 0;
      S.lo = (Math.imul(seed | 0, 0x01000193) ^ S.calls) >>> 0;
      if (HAS_CRYPTO) {
        const w = cryptoWords(2);
        let pair = mix32(S.hi, S.lo, w[0]);
        pair = mix32(pair[0], pair[1], w[1]);
        S.hi = pair[0];
        S.lo = pair[1];
      }
      S.calls = 0;
      // 刷新时间基准，避免首次调用算出「距离上次间隔 1.7e12 ms」这种数字
      S.lastTime = nowMs();
      S.lastDelta = 0;
      S.lastRaw = 0;
      S.lastBits = 0;
      S.lastCrypto = 0;
      S.cryptoWords = 0;
      return App.rng.info();
    }
  };

  // 默认源：有 crypto 就用混合，没有就退化为纯时间
  source = normalizeSource('hybrid');
})(typeof window !== 'undefined' ? window : globalThis);
