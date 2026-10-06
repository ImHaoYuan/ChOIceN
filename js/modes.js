/* =============================================================
   modes.js — 功能注册表与各功能视图
   -------------------------------------------------------------
   未来新增功能（掷骰子 / 抽签 / 随机数…）只需要：
     1) 在 App.modes.list 里加一条记录（id/icon/name/desc/available/mount）
     2) 实现 mount(container, ctx)，在容器里渲染自己的界面
   侧边导航、路由、样式都会自动复用。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});
  const ui = App.ui;
  const el = ui.el;

  /* ---------------------------------------------------------
     功能一：抛硬币（已完成）
     --------------------------------------------------------- */
  const coinMode = {
    id: 'coin',
    icon: '🪙',
    name: '抛硬币',
    desc: '时间随机 · 正反两面',
    available: true,
    mount: mountCoin
  };

  function mountCoin(root, ctx) {
    const store = App.store;
    const settings = store.getSettings();
    let stats = store.getStats();
    let history = store.getHistory();
    let busy = false;

    /*
     * 抛掷动画的两档参数：
     *   - 单次抛掷用原速（2500ms / 5–8 圈），保持「抛起来、慢慢落定」的观感；
     *   - 连抛 10 次用加速档（850ms / 3–4 圈），否则 10 次要点 27 秒以上，
     *     而且中间还有 220ms 停顿，等待感很强。
     * 圈数要跟着时长一起降：时长缩短后若还转 8 圈，角速度过高会糊成一片白，
     * 反而看不清翻转。慢动作（slowMotion）开启时仍会乘上系数，尊重用户选择。
     */
    const FLIP_NORMAL = { duration: 2500, turns: { min: 5, max: 8 } };
    const FLIP_FAST = { duration: 850, turns: { min: 3, max: 4 } };
    const FLIP_FAST_GAP = 110;      // 连抛时两次之间的停顿（原为 220ms）

    /* ---------- 结构 ---------- */
    const statusMain = el('div.stage__status-main', { text: '准备好了吗？' });
    const statusSub = el('div.stage__status-sub', { text: '点击「抛一次」，或直接按空格键' });
    const statusBox = el('div.stage__status', { dataset: { state: 'idle' } }, [statusMain, statusSub]);

    const toss = el('div.toss');
    const coin = App.createCoin({ duration: FLIP_NORMAL.duration, lift: 14, turns: FLIP_NORMAL.turns });
    // 便于调试与自动化测试观察硬币状态
    global.__coin = coin;
    toss.appendChild(coin.el);
    toss.appendChild(el('div.stage-floor'));

    const btnFlip = el('button.btn.btn--primary', { type: 'button' }, [
      el('span', { text: '抛一次' }),
      el('kbd', { text: 'Space' })
    ]);
    const btnTen = el('button.btn.btn--mid', { type: 'button', text: '连抛 10 次' });
    const btnReset = el('button.btn.btn--sm', { type: 'button', text: '重置硬币' });

    const stage = el('section.panel.panel--stage', [
      el('div.stage', [
        statusBox,
        toss,
        el('div.stage__actions', [btnFlip, btnTen, btnReset])
      ])
    ]);

    /* ---------- 结果 / 统计 ---------- */
    const mFace = el('div.metric__value', { text: '—' });
    const mTime = el('div.metric__value', { text: '—' });
    const mTotal = el('div.metric__value', { text: '0' });
    const resultBar = el('div.result-bar', [
      el('div.metric', [el('div.metric__label', { text: '本次结果' }), mFace]),
      el('div.metric', [el('div.metric__label', { text: '落定时刻' }), mTime]),
      el('div.metric', [el('div.metric__label', { text: '累计次数' }), mTotal])
    ]);

    const ratioHeads = el('div.ratio__heads');
    const ratioTails = el('div.ratio__tails');
    const ratioLegend = el('div.ratio__legend');
    const ratio = el('div.ratio', [
      el('div.ratio__legend', { html: '正 <b id="rHeads">0</b>' }),
      el('div.ratio__bar', [ratioHeads, ratioTails]),
      el('div.ratio__legend', { html: '反 <b id="rTails">0</b>' })
    ]);

    /* ---------- 历史 ---------- */
    const historyStrip = el('div.history__strip');
    const historyMeta = el('div.history__meta', { text: '' });
    const historyBox = el('div.history', [
      el('div.history__head', [
        el('div.history__title', { text: '最近结果（最新在左）' }),
        historyMeta
      ]),
      historyStrip
    ]);

    /* ---------- 随机源诊断面板 ----------
       面板本身抽在 js/entropy.js（掷骰子页用的是同一个实例工厂）。
       它自己订阅 App.rng.onChange，所以这里不再需要 offRng；
       顶部栏「显示随机源」开关只负责改它的显隐。 */
    const entropy = App.createEntropyPanel({ visible: settings.showEntropy });

    /* ---------- 与顶部栏开关联动 ----------
       慢动作 / 显示随机源 这两个开关现在住在顶部栏的「更多选项」里，
       视图不自己造开关，只订阅偏好变化：
       app.js 改完设置会广播 (key, value)，这里据此调整硬币速度与面板显隐。 */
    coin.setSpeedFactor(settings.slowMotion ? 1.8 : 1);

    const offSetting = ctx.onSetting ? ctx.onSetting(function (key, value) {
      if (key === 'slowMotion') coin.setSpeedFactor(value ? 1.8 : 1);
      if (key === 'showEntropy') entropy.setVisible(value);
    }) : null;

    const wrap = el('div', [
      el('header.view-head', [
        el('h1', [el('span.view-head__badge', { text: '🪙' }), '抛硬币']),
        // 简介只留这个功能自己的事；随机源原理、动画取舍等长文一律放 #/about
        el('p', [
          '正反两面，一抛定夺。支持连抛 10 次，并累计正反占比与最近结果。',
          el('a.view-head__more', { href: '#/about', text: '随机源与完整说明 →' })
        ])
      ]),
      stage,
      resultBar,
      ratio,
      historyBox,
      entropy.el
    ]);

    root.appendChild(wrap);
    ctx.setActions([{ id: 'coin.entropy' }]);   // 预留：未来可挂全局动作

    /* ---------- 渲染与交互 ---------- */
    function renderStats() {
      const total = stats.total || 0;
      mTotal.textContent = String(total);
      ratioHeads.style.width = (total ? (stats.heads / total) * 100 : 50) + '%';
      ratioTails.style.width = (total ? (stats.tails / total) * 100 : 50) + '%';
      ratioHeads.style.opacity = total ? '1' : '0.25';
      ratioTails.style.opacity = total ? '1' : '0.25';

      const lh = global.document.getElementById('rHeads');
      const lt = global.document.getElementById('rTails');
      if (lh) lh.textContent = stats.heads + ' · ' + ui.formatPercent(stats.heads, total);
      if (lt) lt.textContent = stats.tails + ' · ' + ui.formatPercent(stats.tails, total);
      historyMeta.textContent = total ? '共 ' + total + ' 次' : '暂无记录';
    }

    function renderHistory() {
      ui.clear(historyStrip);
      if (!history.length) {
        historyStrip.appendChild(el('div.chip.chip--empty', { text: '·' }));
        historyStrip.appendChild(el('span', { text: '还没有结果，抛一次试试', style: 'color:var(--text-dim);font-size:12.5px;align-self:center' }));
        return;
      }
      history.slice(0, 24).forEach(function (item) {
        const face = typeof item === 'string' ? item : item.face;
        historyStrip.appendChild(el('div.chip.chip--' + face, {
          text: ui.faceShort(face),
          title: ui.faceText(face) + ' · ' + ui.formatTime(typeof item === 'string' ? 0 : item.at)
        }));
      });
    }

    function setState(state, main, sub) {
      statusBox.dataset.state = state;
      if (main != null) statusMain.textContent = main;
      if (sub != null) statusSub.textContent = sub;
    }

    function setBusy(on) {
      busy = on;
      btnFlip.disabled = on;
      btnTen.disabled = on;
      btnReset.disabled = on;
    }

    /** 记录一次结果 */
    function commit(face, extra) {
      const at = Date.now();
      stats = store.record(face);
      history = store.pushHistory(Object.assign({ face: face, at: at }, extra || {}));
      mFace.textContent = ui.faceText(face);
      mFace.className = 'metric__value metric__value--' + (face === 'tails' ? 'jade' : 'gold');
      mTime.textContent = ui.formatTime(at);
      renderStats();
      renderHistory();
      entropy.render();
    }

    /**
     * 抛一次。
     * @param {object} [opts] { fast } fast 为真时用连抛的加速参数
     */
    function oneFlip(opts) {
      const conf = opts || {};
      const anim = conf.fast ? FLIP_FAST : FLIP_NORMAL;
      return new Promise(function (resolve) {
        const face = App.rng.side();          // ← 结果先由随机源决定，动画只是表演
        coin.flipTo(face, {
          duration: anim.duration,
          turns: anim.turns,
          onLand: function () {
            const info = App.rng.info();
            setState(face, ui.faceText(face) + (face === 'heads' ? ' · 正面朝上' : ' · 反面朝上'),
              '随机位 ' + info.bits.slice(-12) + '（低位=1，所以是' + ui.faceText(face) + '）');
            commit(face);
            App.audio.play('land', face);
            resolve(face);
          }
        });
        App.audio.play('toss');
        // 加速档下 850ms 内再叠一层旋转噪声会糊成噪音，跳过
        if (!conf.fast) global.setTimeout(function () { App.audio.play('spin'); }, 60);
      });
    }

    async function doFlip() {
      if (busy) return;
      setBusy(true);
      setState('flipping', '旋转中…', '正在采集' + App.rng.sourceLabel().name + '熵');
      await oneFlip();
      setBusy(false);
    }

    async function doFlipMany(times) {
      if (busy) return;
      setBusy(true);
      const t0 = Date.now();
      for (let i = 0; i < times; i++) {
        setState('flipping', '旋转中… (' + (i + 1) + '/' + times + ')',
          '连抛模式：动画已加速，结果逐次记录');
        await oneFlip({ fast: true });
        if (i < times - 1) await new Promise(function (r) { global.setTimeout(r, FLIP_FAST_GAP); });
      }
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      setState('idle', '连抛完成', '共 ' + times + ' 次，用时 ' + seconds + ' 秒，结果已记入统计');
      global.setTimeout(function () {
        if (!busy) setState('idle', '准备好了吗？', '点击「抛一次」，或直接按空格键');
      }, 2200);
      setBusy(false);
    }

    btnFlip.addEventListener('click', doFlip);
    btnTen.addEventListener('click', function () { doFlipMany(10); });
    btnReset.addEventListener('click', function () {
      if (busy) return;
      coin.show('heads');
      setState('idle', '准备好了吗？', '点击「抛一次」，或直接按空格键');
      mFace.textContent = '—';
      mFace.className = 'metric__value';
      mTime.textContent = '—';
      ui.toast('硬币已重置（统计记录保留）');
    });

    /* 空格键快捷抛掷 */
    function onKeydown(e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      if (ctx.isActive && !ctx.isActive()) return;
      e.preventDefault();
      doFlip();
    }
    global.document.addEventListener('keydown', onKeydown);

    /* 初始渲染 */
    renderStats();
    renderHistory();
    entropy.render();
    if (!history.length) {
      setState('idle', '准备好了吗？', '点击「抛一次」，或直接按空格键');
    } else {
      const last = history[0];
      const face = typeof last === 'string' ? last : last.face;
      coin.show(face);
      mFace.textContent = ui.faceText(face);
      mFace.className = 'metric__value metric__value--' + (face === 'tails' ? 'jade' : 'gold');
      mTime.textContent = ui.formatTime(typeof last === 'string' ? 0 : last.at);
      setState(face, ui.faceText(face), '上一次的结果 · 按空格再来一次');
    }

    // 开发预览：URL 带 ?demo=1 时自动抛一次，方便截图/自测
    if (/(?:^|[?&])demo=1(?:&|$)/.test(global.location.search || '')) {
      global.setTimeout(doFlip, 260);
    }

    return function destroy() {
      global.document.removeEventListener('keydown', onKeydown);
      // 视图销毁时必须退订，否则每次切功能都会堆积一个订阅者
      if (offSetting) offSetting();
      entropy.destroy();
      coin.destroy();
    };
  }

  /* ---------------------------------------------------------
     功能二：掷骰子
     --------------------------------------------------------- */

  /**
   * 一串互斥的「单选按钮」（骰子颗数 / 每颗面数）。
   * 这类参数明显属于本功能，所以放在视图里，而不是塞进顶部栏的「更多选项」。
   *
   * 高亮（`aria-pressed`）由选择器自己维护，不劳驾调用方：
   * 早期版本把它留给 onChange 去调 setValue，结果点了按钮高光一直不动
   * （属性停在初始值上），所以现在谁都不会忘。
   * onChange 返回 false 表示「这次点击不生效」（例如正在掷骰），此时高光也不动。
   */
  function picker(label, values, current, onChange) {
    const list = el('div.picker__list', { role: 'group', 'aria-label': label });
    const buttons = [];

    function setValue(v) {
      buttons.forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === v));
      });
    }

    values.forEach(function (v) {
      const btn = el('button.picker__btn', {
        type: 'button',
        text: String(v),
        'aria-pressed': String(v === current),
        dataset: { value: String(v) }
      });
      btn.addEventListener('click', function () {
        if (onChange(v) === false) return;
        setValue(v);
      });
      list.appendChild(btn);
      buttons.push(btn);
    });

    return {
      el: el('div.picker', [el('span.picker__label', { text: label }), list]),
      setValue: setValue,
      setEnabled: function (on) {
        buttons.forEach(function (btn) { btn.disabled = !on; });
      }
    };
  }

  /** 一次掷骰的默认颗数（首次打开时） */
  const DICE_DEFAULT_COUNT = 2;
  const DICE_PREF_KEY = 'dicePrefs';   // → choicen.v1.dicePrefs

  function mountDice(root, ctx) {
    const store = App.store;
    const settings = store.getSettings();
    const DICE = App.DICE;

    /*
     * 颗数与面数是本功能自己的参数，不属于全局设置（主题 / 随机源 / 慢动作那类），
     * 所以用 App.store 的通用读写接口单独存一份，同样是 choicen.v1. 前缀。
     */
    const saved = store.read(DICE_PREF_KEY, null) || {};
    const prefs = {
      count: DICE.clampCount(saved.count == null ? DICE_DEFAULT_COUNT : saved.count),
      faces: DICE.clampFaces(saved.faces == null ? 6 : saved.faces)
    };
    function savePrefs() {
      store.write(DICE_PREF_KEY, { count: prefs.count, faces: prefs.faces });
    }

    let stats = store.getDiceStats();
    let history = store.getDiceHistory();
    let busy = false;

    /* 骰子元件：结果先由随机源定，元件只负责表演（与硬币同一条原则） */
    const dice = App.createDice({ count: prefs.count, faces: prefs.faces });
    global.__dice = dice;     // 便于调试与自动化测试观察骰子状态

    /* ---------- 舞台 ---------- */
    const statusMain = el('div.stage__status-main', { text: '准备好了吗？' });
    const statusSub = el('div.stage__status-sub', { text: '点击「掷一次」，或直接按空格键' });
    const statusBox = el('div.stage__status', { dataset: { state: 'idle' } }, [statusMain, statusSub]);

    const btnRoll = el('button.btn.btn--primary', { type: 'button' }, [
      el('span', { text: '掷一次' }),
      el('kbd', { text: 'Space' })
    ]);
    const btnReset = el('button.btn.btn--sm', { type: 'button', text: '重置骰子' });

    const stage = el('section.panel.panel--stage', [
      el('div.stage', [
        statusBox,
        dice.el,
        el('div.stage-floor'),
        el('div.stage__actions', [btnRoll, btnReset])
      ])
    ]);

    /* ---------- 结果 / 统计 ---------- */
    const mFaces = el('div.metric__value.metric__value--list', { text: '—' });
    const mSum = el('div.metric__value', { text: '—' });
    const mRolls = el('div.metric__value', { text: '0' });
    const mDice = el('div.metric__value', { text: '0' });
    const resultBar = el('div.result-bar', [
      el('div.metric', [el('div.metric__label', { text: '本次点数' }), mFaces]),
      el('div.metric', [el('div.metric__label', { text: '本次总和' }), mSum]),
      el('div.metric', [el('div.metric__label', { text: '累计次数' }), mRolls]),
      el('div.metric', [el('div.metric__label', { text: '累计骰子' }), mDice])
    ]);

    /* ---------- 骰子设置 ---------- */
    const countValues = [];
    for (let i = DICE.MIN_COUNT; i <= DICE.MAX_COUNT; i++) countValues.push(i);

    const countPicker = picker('骰子颗数', countValues, prefs.count, function (v) {
      if (busy) return false;
      prefs.count = DICE.clampCount(v);
      dice.setCount(prefs.count);
      savePrefs();
      clearResult();
      renderStats();
      return true;
    });
    const facePicker = picker('每颗面数', DICE.FACE_CHOICES, prefs.faces, function (v) {
      if (busy) return false;
      prefs.faces = DICE.clampFaces(v);
      dice.setFaces(prefs.faces);
      savePrefs();
      clearResult();
      renderDist();
      return true;
    });
    const optionsBox = el('section.panel.dice-opts', [
      el('div.dice-opts__title', { text: '骰子设置' }),
      countPicker.el,
      facePicker.el
    ]);

    /* ---------- 点数分布 ---------- */
    const distBars = el('div.dist__bars');
    const distNote = el('div.dist__note', { text: '' });
    const distBox = el('div.dist', [
      el('div.dist__head', [
        el('div.dist__title', { text: '点数分布（累计 · 按面数分开统计）' }),
        distNote
      ]),
      distBars
    ]);

    /* ---------- 历史 ---------- */
    const historyStrip = el('div.history__strip');
    const historyMeta = el('div.history__meta', { text: '' });
    const historyBox = el('div.history', [
      el('div.history__head', [
        el('div.history__title', { text: '最近总和（最新在左）' }),
        historyMeta
      ]),
      historyStrip
    ]);

    /* ---------- 随机源面板：与抛硬币共用同一个组件 ---------- */
    const entropy = App.createEntropyPanel({ visible: settings.showEntropy });

    dice.setSpeedFactor(settings.slowMotion ? 1.8 : 1);

    const offSetting = ctx.onSetting ? ctx.onSetting(function (key, value) {
      if (key === 'slowMotion') dice.setSpeedFactor(value ? 1.8 : 1);
      if (key === 'showEntropy') entropy.setVisible(value);
    }) : null;

    const wrap = el('div', [
      el('header.view-head', [
        el('h1', [el('span.view-head__badge', { text: '🎲' }), '掷骰子']),
        // 同上：详情在 #/about，这里只留规则本身
        el('p', [
          '1–6 颗骰子，每颗可选 4 / 6 / 8 / 10 / 12 / 20 面；逐颗落定，d6 画点、其它写数字。',
          el('a.view-head__more', { href: '#/about', text: '随机源与完整说明 →' })
        ])
      ]),
      stage,
      resultBar,
      optionsBox,
      distBox,
      historyBox,
      entropy.el
    ]);

    root.appendChild(wrap);
    ctx.setActions([{ id: 'dice.entropy' }]);   // 预留：未来可挂全局动作

    /* ---------- 渲染 ---------- */
    function setState(state, main, sub) {
      statusBox.dataset.state = state;
      if (main != null) statusMain.textContent = main;
      if (sub != null) statusSub.textContent = sub;
    }

    function setBusy(on) {
      busy = on;
      btnRoll.disabled = on;
      btnReset.disabled = on;
      // 掷骰过程中改颗数/面数会让动画与结果对不上，先锁住
      countPicker.setEnabled(!on);
      facePicker.setEnabled(!on);
    }

    function renderStats() {
      mRolls.textContent = String(stats.rolls || 0);
      mDice.textContent = String(stats.dice || 0);
    }

    function renderHistory() {
      ui.clear(historyStrip);
      if (!history.length) {
        historyStrip.appendChild(el('div.chip.chip--empty', { text: '·' }));
        historyStrip.appendChild(el('span', {
          text: '还没有结果，掷一次试试',
          style: 'color:var(--text-dim);font-size:12.5px;align-self:center'
        }));
        historyMeta.textContent = '暂无记录';
        return;
      }
      history.slice(0, 24).forEach(function (item) {
        const values = Array.isArray(item.values) ? item.values : [];
        historyStrip.appendChild(el('div.chip.chip--dice', {
          text: String(item.sum),
          title: 'd' + item.faces + ' · ' + values.join(' + ') + ' = ' + item.sum +
                 ' · ' + ui.formatTime(item.at)
        }));
      });
      historyMeta.textContent = '共 ' + (stats.rolls || 0) + ' 次';
    }

    /**
     * 点数分布图。
     * 只画「当前面数」那一桶：切到 d20 之后，d6 时代的分布口径已经不同，
     * 混在一起画会得出错误的直觉（这也正是 store 里按面数分桶的原因）。
     */
    function renderDist() {
      const faces = dice.getFaces();
      const key = String(faces);
      const bucket = (stats.dist && stats.dist[key]) || {};
      const counts = [];
      let total = 0;
      for (let v = 1; v <= faces; v++) {
        const c = Number(bucket[String(v)]) || 0;
        counts.push(c);
        total += c;
      }
      let max = 0;
      counts.forEach(function (c) { if (c > max) max = c; });

      ui.clear(distBars);
      distBars.dataset.faces = key;
      counts.forEach(function (c, i) {
        const value = i + 1;
        const pct = total ? (c / total) * 100 : 0;
        const barAttrs = { style: 'height:' + (c && max ? Math.max(4, Math.round((c / max) * 100)) : 4) + '%' };
        if (!c) barAttrs.class = 'dist__bar--zero';
        distBars.appendChild(el('div.dist__col', {
          dataset: { value: String(value) },
          title: '点数 ' + value + '：' + c + ' 次' + (total ? '（' + pct.toFixed(1) + '%）' : '')
        }, [
          el('span.dist__count', { text: total ? String(c) : '·' }),
          el('div.dist__track', [el('div.dist__bar', barAttrs)]),
          el('span.dist__label', { text: String(value) })
        ]));
      });

      distNote.textContent = total
        ? 'd' + faces + ' · 累计 ' + total + ' 颗 · 理论 ' + (100 / faces).toFixed(1) + '% / 面'
        : 'd' + faces + ' · 还没有数据';
    }

    /** 把一次结果写到结果区（返回总和） */
    function showResult(values) {
      const faces = dice.getFaces();
      const sum = values.reduce(function (a, b) { return a + b; }, 0);
      mFaces.textContent = values.join(' · ');
      mSum.textContent = String(sum);
      mSum.className = 'metric__value metric__value--gold';
      setState('sum', '总和 ' + sum,
        values.join(' + ') + ' = ' + sum + ' · d' + faces + ' × ' + values.length);
      return sum;
    }

    function clearResult() {
      mFaces.textContent = '—';
      mSum.textContent = '—';
      mSum.className = 'metric__value';
      setState('idle', '准备好了吗？', '点击「掷一次」，或直接按空格键');
    }

    /** 记录一次结果，并刷新统计 / 分布 / 历史 / 随机源面板 */
    function commit(values) {
      const faces = dice.getFaces();
      const sum = values.reduce(function (a, b) { return a + b; }, 0);
      stats = store.recordDice(values, faces);
      history = store.pushDiceHistory({
        values: values.slice(), sum: sum, faces: faces, at: Date.now()
      });
      renderStats();
      renderDist();
      renderHistory();
      entropy.render();
      showResult(values);
      return sum;
    }

    /** 从随机源取本次点数：结果先定下来，动画只是表演 */
    function drawValues() {
      const faces = dice.getFaces();
      const out = [];
      for (let i = 0, n = dice.getCount(); i < n; i++) out.push(App.rng.int(faces) + 1);
      return out;
    }

    async function doRoll() {
      if (busy) return;
      setBusy(true);
      const values = drawValues();
      setState('rolling', '掷骰中…', '正在采集' + App.rng.sourceLabel().name + '熵');
      App.audio.play('shake');
      await dice.roll(values, {
        onLand: function () { App.audio.play('dice'); }
      });
      commit(values);
      App.audio.play('sum');
      setBusy(false);
    }

    btnRoll.addEventListener('click', doRoll);
    btnReset.addEventListener('click', function () {
      if (busy) return;
      dice.clear();
      clearResult();
      ui.toast('骰子已重置（统计记录保留）');
    });

    /* 空格键快捷掷骰 */
    function onKeydown(e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      if (ctx.isActive && !ctx.isActive()) return;
      e.preventDefault();
      doRoll();
    }
    global.document.addEventListener('keydown', onKeydown);

    /* 初始渲染 */
    renderStats();
    renderDist();
    renderHistory();
    entropy.render();

    const lastEntry = history[0];
    const lastValues = lastEntry && Array.isArray(lastEntry.values) ? lastEntry.values : null;
    if (lastValues && lastValues.length === dice.getCount()) {
      dice.show(lastValues);
      showResult(lastValues);
      setState('sum', '总和 ' + lastEntry.sum, '上一次的结果 · 按空格再来一次');
    } else {
      // 上一次掷的颗数与现在的设置不同（或还没有记录）：摆出来会误导，直接留空
      dice.clear();
      clearResult();
    }

    // 开发预览：URL 带 ?demo=1 时自动掷一次
    if (/(?:^|[?&])demo=1(?:&|$)/.test(global.location.search || '')) {
      global.setTimeout(doRoll, 300);
    }

    return function destroy() {
      global.document.removeEventListener('keydown', onKeydown);
      // 视图销毁时必须退订，否则每次切功能都会堆积一个订阅者
      if (offSetting) offSetting();
      entropy.destroy();
      dice.destroy();
    };
  }

  const diceMode = {
    id: 'dice',
    icon: '🎲',
    name: '掷骰子',
    desc: '1–6 颗 · 4/6/8/10/12/20 面',
    available: true,
    mount: mountDice
  };

  /* ---------------------------------------------------------
     功能三 / 四：占位，接口已预留
     --------------------------------------------------------- */
  function makePlaceholderMode(config) {
    return {
      id: config.id,
      icon: config.icon,
      name: config.name,
      desc: config.desc,
      available: false,
      mount: function (root) {
        root.appendChild(el('div', [
          el('header.view-head', [
            el('h1', [el('span.view-head__badge', { text: config.icon }), config.name]),
            el('p', { text: config.intro })
          ]),
          el('div.placeholder', [
            el('div.placeholder__icon', { text: config.icon }),
            el('h2', { text: '规划中的功能' }),
            el('p', { text: config.detail }),
            el('ul.placeholder__roadmap', config.roadmap.map(function (item) {
              return el('li', { text: item });
            }))
          ])
        ]));
      }
    };
  }

  App.modes = {
    defaultId: 'coin',
    list: [
      coinMode,
      diceMode,
      makePlaceholderMode({
        id: 'number',
        icon: '🔢',
        name: '随机数字',
        desc: '自定义范围与个数',
        intro: '在指定区间内生成不重复的随机数字，适合抽奖与分组。',
        detail: '随机源同样来自当前时间，可导出结果。',
        roadmap: ['设定最小值 / 最大值 / 个数', '一键生成与结果复制', '支持排除已抽出的数字']
      }),
      makePlaceholderMode({
        id: 'wheel',
        icon: '🎯',
        name: '转盘抽签',
        desc: '自定义候选项',
        intro: '把候选项放到转盘上，转出决定。',
        detail: '需要更复杂的绘制与物理效果，排在后面实现。',
        roadmap: ['自定义候选项与权重', 'Canvas 转盘动画', '去掉已抽中的选项']
      })
    ],
    get: function (id) {
      return this.list.filter(function (m) { return m.id === id; })[0] || null;
    }
  };
})(window);
