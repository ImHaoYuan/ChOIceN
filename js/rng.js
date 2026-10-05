/* =============================================================
   rng.js — 以「当前时间」为核心的随机源
   -------------------------------------------------------------
   设计说明：
   1. 每次取值都会采集一组随时间变化的熵：
        performance.timeOrigin + performance.now() + Date.now()
        + 调用序号 + 上一次池状态的哈希 + crypto 随机数（若可用）
   2. 用 FNV-1a 变体把这些位混进一个 64 位状态池，做 xorshift 轮转后
      再跑一轮 avalanche，最后归一化到 [0, 1)。
   3. 同一毫秒内的连续调用，会因为调用序号与池回馈而给出不同结果。
   4. 若浏览器提供 crypto.getRandomValues，会以 1 字节的随机值参与混合，
      使序列不可预测；不提供时算法依旧可用（退化为纯时间熵）。
   5. 每个公开取值方法（float / int / side / bytes）都会推进一次状态池，
      不会返回上一次的陈旧结果。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  /* ---- 64 位状态的读写（用高/低 32 位两个数字表示） ---- */
  const U32 = 0x100000000;
  const HIGH_INIT = 0x9e3779b9;

  const S = {
    hi: HIGH_INIT,
    lo: 0x85ebca6b,
    calls: 0,
    lastTime: 0,
    lastDelta: 0,
    lastRaw: 0,
    lastBits: 0,
    hasCrypto: typeof global.crypto !== 'undefined' &&
               typeof global.crypto.getRandomValues === 'function'
  };

  /* ---- FNV-1a 变体：把一个 32 位值混入状态 ---- */
  function mix32(hi, lo, v) {
    lo = (lo ^ (v >>> 0)) >>> 0;
    lo = Math.imul(lo, 0x01000193) >>> 0;          // FNV prime
    hi = (hi ^ (lo >>> 13)) >>> 0;
    hi = Math.imul(hi, 0x85ebca6b) >>> 0;          // murmur 常量
    return [hi >>> 0, lo >>> 0];
  }

  /* ---- xorshift64*：推进状态并返回新的 32 位输出 ---- */
  function xorshift64star(hi, lo) {
    let x = lo >>> 0;
    const y = hi >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    const nlo = x >>> 0;
    const nhi = (y ^ ((x + y) >>> 0)) >>> 0;
    return [nhi >>> 0, nlo >>> 0, Math.imul(nlo, 0x2545f491) >>> 0];
  }

  function nowMs() {
    return Date.now();
  }

  function perfNow() {
    return (global.performance && performance.now) ? performance.now() : 0;
  }

  /* ---- 采集熵并推进状态，返回 [0,1) ---- */
  function next() {
    const t = nowMs();
    const p = perfNow();
    const delta = Math.max(0, t - S.lastTime);
    S.lastTime = t;
    S.lastDelta = delta;
    S.calls = (S.calls + 1) >>> 0;

    let hi = S.hi;
    let lo = S.lo;

    // 时间熵：毫秒时间戳、高精度计时、相邻调用间隔、调用序号
    [hi, lo] = mix32(hi, lo, t);
    [hi, lo] = mix32(hi, lo, Math.floor(p));
    [hi, lo] = mix32(hi, lo, Math.floor((p % 1) * 1e6));
    [hi, lo] = mix32(hi, lo, delta);
    [hi, lo] = mix32(hi, lo, S.calls);
    [hi, lo] = mix32(hi, lo, (t / 1000) | 0);

    // 系统熵：crypto（若可用）
    if (S.hasCrypto) {
      const buf = new Uint8Array(1);
      global.crypto.getRandomValues(buf);
      [hi, lo] = mix32(hi, lo, buf[0]);
    }

    // 推进 + 雪崩
    const out = xorshift64star(hi, lo);
    hi = out[0]; lo = out[1];
    let bits = (out[2] ^ hi ^ lo) >>> 0;
    bits ^= bits >>> 16;
    bits = Math.imul(bits, 0x7feb352d) >>> 0;
    bits ^= bits >>> 15;
    bits = Math.imul(bits, 0x846ca68b) >>> 0;
    // 注意：最后一步必须右移偶数位以外的位数。
    // 若写成 bits ^= bits >>> 31，最低位会被异或成 0，
    // 而 App.rng.side() 正是读取最低位，会导致结果恒为正面。
    bits ^= bits >>> 16;

    S.hi = hi; S.lo = lo;
    S.lastRaw = bits >>> 0;
    S.lastBits = bits >>> 0;

    return (bits >>> 0) / U32;
  }

  /* ---- 公开接口 ---- */
  App.rng = {
    /** [0,1) 均匀随机数 */
    float: next,

    /** [0, max) 整数 */
    int(max) {
      return Math.floor(next() * max);
    },

    /** 由随机位决定的正/反面：0 = 正面(heads)，1 = 反面(tails) */
    side() {
      // 必须自己消耗一次随机数：否则会一直读到上一次的陈旧位。
      next();
      return (S.lastBits & 1) === 0 ? 'heads' : 'tails';
    },

    /** 抽样 n 个随机字节，用于展示熵 */
    bytes(n) {
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(next());
      return arr;
    },

    /** 诊断信息：给界面展示「随机是怎么来的」 */
    info() {
      return {
        time: S.lastTime,
        delta: S.lastDelta,
        calls: S.calls,
        raw: S.lastRaw >>> 0,
        bits: (S.lastBits >>> 0).toString(2).padStart(32, '0'),
        hasCrypto: S.hasCrypto,
        pool: (((S.hi >>> 0).toString(16).padStart(8, '0')) +
               ((S.lo >>> 0).toString(16).padStart(8, '0')))
      };
    },

    /** 重置状态池（清空统计时调用，保证下一次仍是新的时间熵） */
    reseed() {
      S.calls = 0;
      S.hi = HIGH_INIT; S.lo = 0x85ebca6b;
      [S.hi, S.lo] = mix32(S.hi, S.lo, nowMs());
      [S.hi, S.lo] = mix32(S.hi, S.lo, Math.floor(perfNow() * 1000));
      // 刷新时间基准，避免首次调用算出「距离上次间隔 1.7e12 ms」这种数字
      S.lastTime = nowMs();
      S.lastDelta = 0;
      return App.rng.info();
    }
  };
})(window);
