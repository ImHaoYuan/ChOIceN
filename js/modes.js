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
    let lastInfo = App.rng.info();

    /* ---------- 结构 ---------- */
    const statusMain = el('div.stage__status-main', { text: '准备好了吗？' });
    const statusSub = el('div.stage__status-sub', { text: '点击「抛一次」，或直接按空格键' });
    const statusBox = el('div.stage__status', { dataset: { state: 'idle' } }, [statusMain, statusSub]);

    const toss = el('div.toss');
    const coin = App.createCoin({ duration: 2500, lift: 14, turns: { min: 5, max: 8 } });
    // 便于调试与自动化测试观察硬币状态
    global.__coin = coin;
    toss.appendChild(coin.el);
    toss.appendChild(el('div.coin-floor'));

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

    /* ---------- 随机源诊断 ---------- */
    const eTime = el('b');
    const eDelta = el('b');
    const eCalls = el('b');
    const eBits = el('b');
    const ePool = el('b');
    const eSource = el('b');
    const entropyBox = el('div.entropy', [
      el('div.entropy__title', { text: '本次随机是怎么来的' }),
      el('div.entropy__row', [
        el('span.entropy__item', [el('span', { text: '时间戳 ' }), eTime]),
        el('span.entropy__item', [el('span', { text: '与上次间隔 ' }), eDelta]),
        el('span.entropy__item', [el('span', { text: '池内调用数 ' }), eCalls]),
        el('span.entropy__item', [el('span', { text: '状态池 ' }), ePool]),
        el('span.entropy__item', [el('span', { text: 'crypto ' }), eSource])
      ]),
      el('div.entropy__row', [
        el('span.entropy__item', [el('span', { text: '输出位 ' }), eBits])
      ])
    ]);

    /* ---------- 设置 ---------- */
    function makeSwitch(label, key, onChange) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!settings[key];
      input.addEventListener('change', function () {
        settings[key] = input.checked;
        store.setSetting(key, input.checked);
        if (onChange) onChange(input.checked);
      });
      return el('label.switch', [input, el('span.switch__track'), el('span', { text: label })]);
    }

    const swSlow = makeSwitch('慢动作', 'slowMotion', function (on) {
      coin.setSpeedFactor(on ? 1.8 : 1);
    });
    const swEntropy = makeSwitch('显示随机源', 'showEntropy', function (on) {
      entropyBox.hidden = !on;
    });
    coin.setSpeedFactor(settings.slowMotion ? 1.8 : 1);
    entropyBox.hidden = !settings.showEntropy;

    const wrap = el('div', [
      el('header.view-head', [
        el('h1', [el('span.view-head__badge', { text: '🪙' }), '抛硬币']),
        el('p', {
          text: '结果来自「当前时间」组成的随机源：毫秒时间戳、高精度计时、调用间隔与调用序号会一起混入 64 位状态池。' +
                '每次点击都会采集新的时间熵，因此同一毫秒内的连续抛掷也不会重复。'
        })
      ]),
      stage,
      resultBar,
      ratio,
      historyBox,
      entropyBox,
      el('div.settings', [swSlow, swEntropy])
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

    function renderEntropy() {
      const info = lastInfo;
      const d = new Date(info.time);
      const pad = function (n, w) { return String(n).padStart(w || 2, '0'); };
      eTime.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' +
        pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
      eDelta.textContent = (info.delta || 0) + ' ms';
      eCalls.textContent = String(info.calls);
      eBits.textContent = info.bits;
      ePool.textContent = '0x' + info.pool;
      eSource.textContent = info.hasCrypto ? '已混入' : '不可用';
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
      lastInfo = App.rng.info();
      mFace.textContent = ui.faceText(face);
      mFace.className = 'metric__value metric__value--' + (face === 'tails' ? 'jade' : 'gold');
      mTime.textContent = ui.formatTime(at);
      renderStats();
      renderHistory();
      renderEntropy();
    }

    function oneFlip() {
      return new Promise(function (resolve) {
        const face = App.rng.side();          // ← 结果先由时间随机源决定
        coin.flipTo(face, {
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
        global.setTimeout(function () { App.audio.play('spin'); }, 60);
      });
    }

    async function doFlip() {
      if (busy) return;
      setBusy(true);
      setState('flipping', '旋转中…', '正在采集时间熵');
      await oneFlip();
      setBusy(false);
    }

    async function doFlipMany(times) {
      if (busy) return;
      setBusy(true);
      for (let i = 0; i < times; i++) {
        setState('flipping', '旋转中… (' + (i + 1) + '/' + times + ')', '连续抛掷，结果逐次记录');
        await oneFlip();
        if (i < times - 1) await new Promise(function (r) { global.setTimeout(r, 220); });
      }
      setState('idle', '连抛完成', '共 ' + times + ' 次，结果已记入统计');
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
    renderEntropy();
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
      coin.destroy();
    };
  }

  /* ---------------------------------------------------------
     功能二 / 三 / 四：占位，接口已预留
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
      makePlaceholderMode({
        id: 'dice',
        icon: '🎲',
        name: '掷骰子',
        desc: '1–6 点随机',
        intro: '同时使用同一套时间随机源，掷出一颗或多颗骰子。',
        detail: '该功能会在抛硬币之后加入，复用同样的动画与统计框架。',
        roadmap: ['支持 1–6 颗骰子与自定义面数', '逐颗落定动画与点数和统计', '历史记录与概率分布图']
      }),
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
