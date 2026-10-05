/* =============================================================
   coin.js — 硬币元件：翻转动画 + 时间随机结果
   -------------------------------------------------------------
   渲染模型（重要，改动前请先读）：
   刻意不使用 rotateX + preserve-3d + backface-visibility 的经典 3D 硬币方案。
   那套方案依赖渲染器实现细节，实测在部分环境下会给出「镜像的正面字」：
     · DOM 里存在 filter（哪怕只是 filter: blur(0)）会让 3D 上下文扁平化；
     · 部分渲染器忽略 backface-visibility；
     · 3D 上下文里子元素的绘制顺序由深度排序决定，不保证按 DOM 顺序。

   这里改为纯 2D 的透视模拟，结果为确定性的：
     · 垂直缩放 |cos(角度)| 模拟转轴压扁，最小值给出「侧面对着你」的瞬间；
     · 上下两个错位图层（--top / --bottom）露出的一点底色即为硬币厚度；
     · 由 JS 按角度显式切换币面：0°–90° / 270°–360° 显示正面，90°–270° 显示反面；
     · 运动模糊放在独立的 --blur 图层，按角速度调模糊量与透明度。

   结果始终先由 App.rng（时间熵）决定，动画只负责表现。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  const FACES = {
    heads: { glyph: '正', caption: 'Heads', mod: 'front' },
    tails: { glyph: '反', caption: 'Tails', mod: 'back' }
  };

  function faceMarkup(face) {
    const f = FACES[face];
    return '<div class="coin__face coin__face--' + f.mod + '">' +
      '<span class="face-marks"></span>' +
      '<span class="coin__glyph">' + f.glyph + '</span>' +
      '<span class="coin__caption">' + f.caption + '</span>' +
      '<span class="coin__year">· 时 间 随 机 ·</span>' +
    '</div>';
  }

  /** 一个图层 = 完整的一枚硬币（正反两面） */
  function layerMarkup() {
    return faceMarkup('heads') + faceMarkup('tails');
  }

  function createCoin(options) {
    const opts = options || {};
    const DURATION = opts.duration || 2500;
    const LIFT_RATIO = opts.lift == null ? 14 : opts.lift;    // 抛起高度（相对硬币直径）
    const TURNS = opts.turns || { min: 5, max: 8 };
    const BLUR_PEAK = opts.blurPeak == null ? 2.4 : opts.blurPeak;
    const MIN_SCALE = 0.04;                                   // 侧面时的最小压扁系数

    const coinEl = document.createElement('div');
    coinEl.className = 'coin';
    coinEl.innerHTML =
      '<div class="coin__layer coin__layer--bottom">' + layerMarkup() + '</div>' +
      '<div class="coin__layer coin__layer--top">' + layerMarkup() + '</div>' +
      '<div class="coin__layer coin__layer--top coin__layer--blur">' + layerMarkup() + '</div>';

    const bottom = coinEl.children[0];
    const sharp = coinEl.children[1];
    const blur = coinEl.children[2];
    const sharpFaces = { heads: sharp.children[0], tails: sharp.children[1] };
    const blurFaces = { heads: blur.children[0], tails: blur.children[1] };

    const area = document.createElement('div');
    area.className = 'coin-area';
    const shadow = document.createElement('div');
    shadow.className = 'coin-shadow';
    area.appendChild(shadow);
    area.appendChild(coinEl);

    let rotation = 0;
    let flipping = false;
    let speedFactor = 1;
    let rafId = 0;
    let lastAngle = 0;
    let lastNow = 0;
    let lastBlur = -1;
    let bottomFace = null;
    let topFace = null;

    function norm(deg) { return ((deg % 360) + 360) % 360; }

    /** 角度 → 朝向哪一面 */
    function facingOf(angle) {
      const a = norm(angle);
      return (a < 90 || a >= 270) ? 'heads' : 'tails';
    }

    function setVisible(map, face) {
      Object.keys(map).forEach(function (key) {
        map[key].classList.toggle('coin__face--hidden', key !== face);
      });
    }

    /** 把硬币摆到指定角度（含压扁、位移、厚度与模糊） */
    function apply(rot, lift, blurAmount) {
      const a = norm(rot);
      const facing = facingOf(a);
      const rad = a * Math.PI / 180;
      const scaleY = Math.max(MIN_SCALE, Math.abs(Math.cos(rad)));

      coinEl.style.transform =
        'translate3d(0,' + (-lift).toFixed(2) + 'px,0) scaleY(' + scaleY.toFixed(4) + ')';

      // 清晰层：按角度切换币面
      if (facing !== topFace) {
        topFace = facing;
        setVisible(sharpFaces, facing);
      }
      // 下层的币面与上层相反，压扁时从边缘露出的一线即为硬币厚度
      const under = facing === 'heads' ? 'tails' : 'heads';
      if (under !== bottomFace) {
        bottomFace = under;
        setVisible({ heads: bottom.children[0], tails: bottom.children[1] }, under);
      }

      // 模糊层：同一个朝向下叠加残影
      if (blurAmount !== lastBlur) {
        lastBlur = blurAmount;
        blur.style.filter = blurAmount > 0.02 ? 'blur(' + blurAmount.toFixed(2) + 'px)' : 'none';
        blur.style.opacity = blurAmount > 0.02
          ? Math.min(0.85, 0.2 + (blurAmount / BLUR_PEAK) * 0.55).toFixed(3)
          : '0';
      }
      setVisible(blurFaces, facing);

      // 阴影随高度收缩、变淡
      const near = 1 - Math.min(lift / (LIFT_RATIO * 4.2), 0.55);
      shadow.style.opacity = near.toFixed(3);
      shadow.style.transform = 'translateX(-50%) scale(' + (0.55 + near * 0.5).toFixed(3) + ')';
    }

    /** 立刻显示某一面（不播放动画） */
    function show(face) {
      rotation = face === 'tails' ? 180 : 0;
      lastBlur = -1;
      apply(rotation, 0, 0);
      coinEl.classList.remove('coin--landed');
    }

    /**
     * 抛一次。
     * @param {string} face  结果面：'heads' | 'tails'（由 App.rng 事先决定）
     * @param {object} [cfg] { duration, onLand }
     * @returns {Promise<void>}
     */
    function flipTo(face, cfg) {
      const conf = cfg || {};
      if (flipping) return Promise.resolve();
      flipping = true;
      coinEl.classList.remove('coin--landed');

      const duration = (conf.duration || DURATION) * speedFactor;
      const turns = TURNS.min + App.rng.int(TURNS.max - TURNS.min + 1);
      const start = rotation;
      const target = start + turns * 360 +
        ((((face === 'tails' ? 180 : 0) - start) % 360) + 360) % 360;

      const t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      let landed = false;
      let resolveFn = null;
      const promise = new Promise(function (r) { resolveFn = r; });

      lastNow = t0;
      lastAngle = start;

      function frame(now) {
        const elapsed = now - t0;
        const k = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - k, 3);              // easeOutCubic
        const rot = start + (target - start) * eased;
        const height = Math.sin(Math.PI * k) * LIFT_RATIO * 4.2;

        // 角速度 → 模糊量
        const dt = Math.max(8, now - lastNow);
        const degPerSec = Math.abs(rot - lastAngle) / dt * 1000;
        lastNow = now;
        lastAngle = rot;
        const blurAmount = Math.min(BLUR_PEAK, Math.max(0, (degPerSec - 320) / 900) * BLUR_PEAK);

        apply(rot, height, blurAmount);

        if (k < 1) {
          rafId = global.requestAnimationFrame(frame);
          return;
        }

        rotation = norm(target);
        lastBlur = -1;
        apply(rotation, 0, 0);
        flipping = false;
        if (!landed) {
          landed = true;
          coinEl.classList.add('coin--landed');
          global.setTimeout(function () { coinEl.classList.remove('coin--landed'); }, 900);
          if (typeof conf.onLand === 'function') conf.onLand(face);
        }
        resolveFn();
      }

      rafId = global.requestAnimationFrame(frame);
      return promise;
    }

    show(opts.initialFace === 'tails' ? 'tails' : 'heads');

    return {
      el: area,
      coinEl: coinEl,
      show: show,
      flipTo: flipTo,
      isFlipping: function () { return flipping; },
      setSpeedFactor: function (f) { speedFactor = f || 1; },
      /** 供测试/调试：当前朝向角（0 = 正面，180 = 反面） */
      currentAngle: function () { return rotation; },
      /** 供测试/调试：摆到任意角度并返回此刻显示的币面 */
      renderAngle: function (deg) {
        rotation = norm(deg);
        lastBlur = -1;
        apply(rotation, 0, 0);
        return facingOf(rotation);
      },
      /** 供测试/调试：当前清晰层里可见的币面 */
      visibleFace: function () {
        if (!sharpFaces.heads.classList.contains('coin__face--hidden')) return 'heads';
        if (!sharpFaces.tails.classList.contains('coin__face--hidden')) return 'tails';
        return null;
      },
      destroy: function () { if (rafId) global.cancelAnimationFrame(rafId); }
    };
  }

  App.createCoin = createCoin;
})(window);
