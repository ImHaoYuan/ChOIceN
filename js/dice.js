/* =============================================================
   dice.js — 骰子元件：多颗骰子的翻滚与逐颗落定
   -------------------------------------------------------------
   与 coin.js 同一条原则：**结果先由 App.rng 决定，动画只负责表演**。
   取值在视图里完成（App.rng.int(faces) + 1），本模块只接收结果值。

   渲染模型：
     · 骰子是圆角方块 + 九宫格点阵（位置见 PIP_LAYOUT 与 CSS 的 .die__pip--*）；
     · faces === 6 时画点数（真实骰子的观感），其它面数（d4/d8/d10/d12/d20）
       直接写数字 —— 用点数表现 d20 既画不下也看不懂；
     · 翻滚是纯 2D 的 CSS keyframes（旋转 + 抬起 + 缩放 + 阴影收缩），
       刻意不用 3D 变换，理由与 coin.js 完全相同（渲染器实现差异，
       见 css/styles.css 里 .coin 与 @keyframes dieTumble 上的注释）。

   两个容易踩的点：
     1) 翻滚时闪动的「假面」必须用本地小 PRNG，**绝不能消耗 App.rng**：
        否则诊断面板里的调用数/系统随机数会被动画噪声污染，
        也违背「动画只是表演」这个前提（随机源只在取值那一刻被使用）。
     2) 起身高度要留出空间：骰子会被抛起约 0.44 个骰子高，
        容器顶部必须留白，否则会被 .panel--stage 的 overflow:hidden 裁掉。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  const MIN_COUNT = 1;
  const MAX_COUNT = 6;
  const MIN_FACES = 2;
  const MAX_FACES = 100;

  /** 可选面数（真实存在的骰子规格）。组件本身支持任意 2–100 面。 */
  const FACE_CHOICES = [4, 6, 8, 10, 12, 20];

  /* 1–6 的点阵位置：九宫格缩写 tl/tc/tr/ml/mc/mr/bl/bc/br */
  const PIP_LAYOUT = {
    1: ['mc'],
    2: ['tr', 'bl'],
    3: ['tr', 'mc', 'bl'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'mc', 'bl', 'br'],
    6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br']
  };

  /* 翻滚参数：一颗一颗地落定（stagger 是每颗的起跑间隔） */
  const ROLL_NORMAL = { duration: 720, stagger: 130, flicker: 70 };

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function clampCount(n) {
    return clamp(Math.round(Number(n) || MIN_COUNT), MIN_COUNT, MAX_COUNT);
  }

  function clampFaces(n) {
    return clamp(Math.round(Number(n) || 6), MIN_FACES, MAX_FACES);
  }

  /** 系统开启「减少动态效果」时，动画压到接近瞬时（CSS 里也会压，但 JS 的计时器要自己收） */
  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  /**
   * 创建一副骰子。
   * @param {object} [options] { count:1–6, faces:2–100 }
   * @returns {object} 元件接口（见文件末尾 return）
   */
  function createDice(options) {
    const opts = options || {};
    const el = App.ui.el;

    let faces = clampFaces(opts.faces == null ? 6 : opts.faces);
    let count = clampCount(opts.count == null ? 1 : opts.count);
    let speedFactor = 1;
    let rolling = false;
    /** 假面的本地 PRNG 状态；与 App.rng 完全无关 */
    let flicker = ((Date.now() ^ 0x5f3759df) >>> 0) || 1;

    const timeouts = [];
    const intervals = [];
    const nodes = [];      // { slot, die, face, value, timer }

    const tray = el('div.dice-tray');

    function makeSlot() {
      const face = el('div.die__face');
      const die = el('div.die', [face]);
      const shadow = el('span.die__shadow', { 'aria-hidden': 'true' });
      const slot = el('div.die-slot', { dataset: { value: '0' } }, [shadow, die]);
      return { slot: slot, die: die, face: face, value: 0, timer: 0 };
    }

    /** 把某一颗骰子画成指定点数；value 为 0 表示「还没掷过」的空面 */
    function renderFace(node, value) {
      node.value = value;
      node.slot.dataset.value = String(value);
      node.slot.classList.toggle('die-slot--empty', !value);
      App.ui.clear(node.face);
      if (!value) return;

      if (faces === 6) {
        (PIP_LAYOUT[value] || PIP_LAYOUT[1]).forEach(function (pos) {
          node.face.appendChild(el('span.die__pip.die__pip--' + pos));
        });
        return;
      }
      node.face.appendChild(el('span.die__num', { text: String(value) }));
    }

    function stopFlicker(node) {
      if (node.timer) {
        global.clearInterval(node.timer);
        node.timer = 0;
      }
    }

    /** 翻滚期间的闪面：只改显示，不碰任何随机源 */
    function startFlicker(node, ms) {
      stopFlicker(node);
      node.timer = global.setInterval(function () {
        flicker = (Math.imul(flicker, 1664525) + 1013904223) >>> 0;
        const v = 1 + ((flicker >>> 9) % faces);
        if (v !== node.value) renderFace(node, v);
      }, ms);
      intervals.push(node.timer);
    }

    function setCount(next) {
      count = clampCount(next);
      while (nodes.length < count) {
        const node = makeSlot();
        renderFace(node, 0);
        tray.appendChild(node.slot);
        nodes.push(node);
      }
      while (nodes.length > count) {
        const node = nodes.pop();
        stopFlicker(node);
        if (node.slot.parentNode) node.slot.parentNode.removeChild(node.slot);
      }
      nodes.forEach(function (node, i) { node.slot.dataset.index = String(i); });
      return count;
    }

    /** 换面数：旧点数在新面数下没有意义，一律清空（由视图决定何时调用） */
    function setFaces(next) {
      faces = clampFaces(next);
      nodes.forEach(function (node) {
        stopFlicker(node);
        node.slot.classList.remove('die-slot--rolling', 'die-slot--landed');
        renderFace(node, 0);
      });
      return faces;
    }

    /** 立即摆出结果，不播放动画（恢复历史、重置时用） */
    function show(values) {
      const list = values || [];
      nodes.forEach(function (node, i) {
        stopFlicker(node);
        node.slot.classList.remove('die-slot--rolling', 'die-slot--landed');
        renderFace(node, list[i] || 0);
      });
      return getValues();
    }

    /**
     * 翻滚并落定。
     * @param {number[]} values 每颗骰子的结果（由调用方先从 App.rng 取好）
     * @param {object} [cfg] { onLand:(index,value)=>void }
     * @returns {Promise<number[]>} 全部落定后兑现
     */
    function roll(values, cfg) {
      const conf = cfg || {};
      const list = (values || []).slice(0, nodes.length);
      if (rolling || !list.length) return Promise.resolve(rolling ? null : list);

      rolling = true;
      const base = ROLL_NORMAL;
      const reduced = prefersReducedMotion();
      const duration = Math.max(1, Math.round((reduced ? 60 : base.duration) * speedFactor));
      const stagger = Math.round((reduced ? 0 : base.stagger) * speedFactor);

      return new Promise(function (resolve) {
        let landed = 0;
        list.forEach(function (value, i) {
          const node = nodes[i];
          node.slot.style.setProperty('--tumble-dur', duration + 'ms');
          // 圈数取 2–4 的整数倍：落定后净旋转为 0°，骰子不会歪着停住
          node.slot.style.setProperty('--spin', (360 * (2 + ((i + flicker) % 3))) + 'deg');
          node.slot.classList.remove('die-slot--landed');
          node.slot.classList.add('die-slot--rolling');
          startFlicker(node, base.flicker);

          const id = global.setTimeout(function () {
            stopFlicker(node);
            node.slot.classList.remove('die-slot--rolling');
            renderFace(node, value);
            node.slot.classList.add('die-slot--landed');
            const id2 = global.setTimeout(function () {
              node.slot.classList.remove('die-slot--landed');
            }, 520);
            timeouts.push(id2);
            if (typeof conf.onLand === 'function') conf.onLand(i, value);
            landed++;
            if (landed >= list.length) {
              rolling = false;
              resolve(list);
            }
          }, stagger * i + duration);
          timeouts.push(id);
        });
      });
    }

    function getValues() {
      return nodes.map(function (node) { return node.value; });
    }

    function destroy() {
      rolling = false;
      nodes.forEach(stopFlicker);
      timeouts.forEach(function (id) { global.clearTimeout(id); });
      intervals.forEach(function (id) { global.clearInterval(id); });
      timeouts.length = 0;
      intervals.length = 0;
    }

    setCount(count);

    return {
      el: tray,
      /** 设置颗数（1–6），返回生效值 */
      setCount: setCount,
      getCount: function () { return count; },
      /** 设置面数（2–100），会清空当前点数 */
      setFaces: setFaces,
      getFaces: function () { return faces; },
      show: show,
      roll: roll,
      clear: function () { return show([]); },
      getValues: getValues,
      isRolling: function () { return rolling; },
      setSpeedFactor: function (f) { speedFactor = f || 1; },
      getSpeedFactor: function () { return speedFactor; },
      /** 供测试/调试：某颗骰子当前显示的点数 */
      valueAt: function (i) { return nodes[i] ? nodes[i].value : 0; },
      /** 供测试/调试：窗口内所有骰子节点 */
      nodes: function () { return nodes.slice(); },
      destroy: destroy
    };
  }

  App.createDice = createDice;

  /* 常量与工具（视图用来生成颗数/面数选择器，也便于测试引用） */
  App.DICE = {
    MIN_COUNT: MIN_COUNT,
    MAX_COUNT: MAX_COUNT,
    MIN_FACES: MIN_FACES,
    MAX_FACES: MAX_FACES,
    FACE_CHOICES: FACE_CHOICES,
    PIP_LAYOUT: PIP_LAYOUT,
    clampCount: clampCount,
    clampFaces: clampFaces
  };
})(window);
