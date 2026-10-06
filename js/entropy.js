/* =============================================================
   entropy.js — 「本次随机是怎么来的」诊断面板
   -------------------------------------------------------------
   抛硬币与掷骰子共用这一个面板（这段代码原来写在 modes.js 的硬币视图里，
   掷骰子也要显示随机源，再抄一份就会有第二处需要同步的渲染逻辑）。

   面板自己订阅 App.rng.onChange，视图只负责创建、调用 render() 与 setVisible()。

   两个字段必须分开显示，不要合并：
     · 「随机源」= 当前选中的源（App.rng.getSource()）
     · 「本次取值」= 上一次取值实际走的路径（info.source）
   刚切换源、还没取值时 info.source 仍是旧值，只显示它就会出现
   「顶部栏已经切到加密、面板还写着混合」的不一致。
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  function nameOf(key) {
    return App.rng.SOURCE_LABEL[key] ? App.rng.SOURCE_LABEL[key].name : key;
  }

  /**
   * 创建一个随机源诊断面板。
   * @param {object} [options] { visible:boolean } 初始是否显示
   * @returns {{el:Element, render:Function, setVisible:Function, isVisible:Function, destroy:Function}}
   */
  App.createEntropyPanel = function (options) {
    const el = App.ui.el;
    const opts = options || {};

    /** 一个「标签 + 数值」单元；数值节点留给 paint() 更新 */
    function field(label) {
      const value = el('b');
      return { item: el('span.entropy__item', [el('span', { text: label }), value]), value: value };
    }

    const fSource = field('随机源 ');
    const fUsed = field('本次取值 ');
    const fCryptoUse = field('系统熵 ');
    const fCryptoRaw = field('系统随机数 ');
    const fTime = field('时间戳 ');
    const fDelta = field('与上次间隔 ');
    const fCalls = field('池内调用数 ');
    const fPool = field('状态池 ');
    const fBits = field('输出位 ');
    const fCryptoWords = field('累计系统取值 ');

    const root = el('div.entropy', [
      el('div.entropy__title', { text: '本次随机是怎么来的' }),
      el('div.entropy__row', [fSource.item, fUsed.item, fCryptoUse.item, fCryptoRaw.item]),
      el('div.entropy__row', [fTime.item, fDelta.item, fCalls.item, fPool.item]),
      el('div.entropy__row', [fBits.item, fCryptoWords.item])
    ]);

    function paint() {
      const info = App.rng.info();
      const d = new Date(info.time);
      fSource.value.textContent = nameOf(App.rng.getSource());
      fUsed.value.textContent = nameOf(info.source);
      const usedCrypto = info.source === 'crypto' || info.source === 'hybrid';
      fCryptoUse.value.textContent = usedCrypto ? '已使用' : (info.hasCrypto ? '未使用' : '不可用');
      fCryptoRaw.value.textContent = info.crypto ? '0x' + info.crypto.toString(16).padStart(8, '0') : '—';
      fCryptoWords.value.textContent = info.hasCrypto ? info.cryptoWords + ' 字' : '—';
      fTime.value.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' +
        pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
      fDelta.value.textContent = (info.delta || 0) + ' ms';
      fCalls.value.textContent = String(info.calls);
      fBits.value.textContent = info.bits;
      fPool.value.textContent = '0x' + info.pool;
    }

    const off = App.rng.onChange(paint);

    root.hidden = !opts.visible;
    paint();

    return {
      el: root,
      /** 重新读取 App.rng.info() 刷新（每次取值后调用） */
      render: paint,
      setVisible: function (on) { root.hidden = !on; },
      isVisible: function () { return !root.hidden; },
      /** 视图销毁时必须调用，否则会留下一个操作已销毁 DOM 的订阅者 */
      destroy: function () { off(); }
    };
  };
})(window);
