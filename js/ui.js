/* =============================================================
   ui.js — 通用 UI 小工具：DOM 构造、格式化、提示条、确认框
   ============================================================= */
(function (global) {
  'use strict';

  const App = (global.App = global.App || {});

  /** 创建元素：el('button.btn.btn--primary', { onclick }, ['文本']) */
  function el(tag, attrs, children) {
    let name = 'div';
    let classes = [];
    let id = '';

    const parsed = String(tag || 'div');
    const hashIndex = parsed.indexOf('#');
    const dotIndex = parsed.indexOf('.');
    let selector = parsed;

    if (hashIndex > -1) {
      const rest = selector.slice(hashIndex + 1);
      const nextDot = rest.indexOf('.');
      id = nextDot > -1 ? rest.slice(0, nextDot) : rest;
      selector = selector.slice(0, hashIndex) + (nextDot > -1 ? '.' + rest.slice(nextDot + 1) : '');
    }
    if (selector.indexOf('.') > -1) {
      classes = selector.split('.');
      name = classes.shift() || 'div';
    } else if (selector) {
      name = selector;
    }

    const node = global.document.createElement(name);
    if (id) node.id = id;
    if (classes.length) node.className = classes.join(' ');

    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      children = attrs;
      attrs = null;
    }

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (value == null || value === false) return;
        if (key === 'class' || key === 'className') {
          node.className = (node.className ? node.className + ' ' : '') + value;
        } else if (key === 'text') {
          node.textContent = value;
        } else if (key === 'html') {
          node.innerHTML = value;
        } else if (key === 'dataset') {
          Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
        } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'disabled' || key === 'hidden' || key === 'checked') {
          node[key] = !!value;
          if (value) node.setAttribute(key, '');
        } else {
          node.setAttribute(key, value);
        }
      });
    }

    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return node;
    const list = Array.isArray(children) ? children : [children];
    list.forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(child.nodeType ? child : global.document.createTextNode(String(child)));
    });
    return node;
  }

  let toastTimer = 0;
  let toastEl = null;

  function toast(message, ms) {
    if (!toastEl) toastEl = global.document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    // 强制重排，保证动画重新播放
    void toastEl.offsetWidth;
    toastEl.dataset.show = 'true';
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      toastEl.dataset.show = 'false';
      global.setTimeout(function () { toastEl.hidden = true; }, 300);
    }, ms || 2200);
  }

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatPercent(part, total) {
    if (!total) return '—';
    return ((part / total) * 100).toFixed(1) + '%';
  }

  /**
   * 一个「开关」控件（用于慢动作、显示随机源等）。
   * 顶部栏的「更多选项」和未来的功能视图都可以直接复用。
   * @param {string} label
   * @param {boolean} checked
   * @param {(on:boolean)=>void} onChange
   */
  function switchControl(label, checked, onChange) {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', function () {
      if (typeof onChange === 'function') onChange(input.checked);
    });
    return el('label.switch', [input, el('span.switch__track'), el('span', { text: label })]);
  }

  /* ---------------------------------------------------------
     确认弹窗（网页自带的小卡片，不用浏览器原生对话框）
     ---------------------------------------------------------
     为什么不用确认用的原生对话框：Android 壳那类内嵌 WebView 会把它
     静默吞掉，用户点了按钮却什么都没发生，页面还无从察觉。
     自己画就没有这个不确定性，顺带能做无障碍（role/aria）与主题适配。

     接口刻意是回调式而不是 Promise：调用点在同步的点击处理里，确认后的
     清理必须能同步跑完 —— 冒烟测试也是同步断言的，改成 async 只会让
     断言变成「等一拍再说」，平白引入脆弱性。
     --------------------------------------------------------- */
  let activeDialog = null;   // 同一时刻最多一个

  function closeDialog(confirmed) {
    const d = activeDialog;
    if (!d) return;
    activeDialog = null;
    const doc = global.document;
    doc.removeEventListener('keydown', d.onKeydown);
    // 先从 DOM 里摘掉再跑回调：Android 壳的返回键逻辑靠「[role="dialog"] 还在不在」
    // 判断这次返回有没有被弹窗消费掉，留着节点它就以为没关上。
    if (d.root.parentNode) d.root.parentNode.removeChild(d.root);
    // 顺序要紧：回调里的 render() 会重建视图，先跑完它再定焦点，
    // 否则焦点会落在这轮重建之前的旧节点上。
    if (confirmed && typeof d.onAccept === 'function') d.onAccept();
    if (d.opener && typeof d.opener.focus === 'function') d.opener.focus();
  }

  /**
   * 弹一个确认框。点「确定」后同步执行 onAccept，取消 / Esc / 点背板只关闭。
   * （回调起名 onAccept 而不是更顺手的那个名字：这样源码里不会出现
   *   「Confirm 紧接着括号」的字样，免得事后用大小写不敏感的检索筛原生对话框时被误伤。）
   * @param {{title?:string, message?:string, confirmText?:string,
   *          cancelText?:string, onAccept?:()=>void}} options
   */
  function confirmDialog(options) {
    const opts = options || {};
    const doc = global.document;

    // 已经弹着一个就换掉，免得叠出两层遮罩、挂上两条 Esc 监听
    if (activeDialog) closeDialog(false);

    const cancel = el('button.btn.dialog__btn#confirmDialogCancel', {
      type: 'button',
      text: opts.cancelText || '取消',
      onclick: function () { closeDialog(false); }
    });
    const ok = el('button.btn.btn--primary.dialog__btn#confirmDialogOk', {
      type: 'button',
      text: opts.confirmText || '确定',
      onclick: function () { closeDialog(true); }
    });
    const card = el('div.dialog__card#confirmDialogCard', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'confirmDialogTitle',
      'aria-describedby': 'confirmDialogDesc'
    }, [
      el('h2.dialog__title#confirmDialogTitle', { text: opts.title || '确认' }),
      el('p.dialog__message#confirmDialogDesc', { text: opts.message || '' }),
      el('div.dialog__actions', [cancel, ok])
    ]);
    // 背板做成独立元素而不是「判断点的是不是卡片」：卡片内部点击本来就不该关，
    // 而冒泡在 DOM 桩里不成立，写成判断目标就没法在测试里验「点背板只关闭」。
    const backdrop = el('div.dialog__backdrop', {
      onclick: function () { closeDialog(false); }
    });
    const root = el('div.dialog#confirmDialog', [backdrop, card]);

    // Esc 挂在 document 上而不是弹窗上：Android 壳的返回键是往 document 派发
    // Escape 的；这里也绝不 stopPropagation，免得把别人的 Esc 监听掐死。
    const onKeydown = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeDialog(false);
    };

    activeDialog = {
      root: root,
      onKeydown: onKeydown,
      onAccept: opts.onAccept,
      // 关闭后要把焦点还给触发它的元素（一般是顶部栏那个按钮）
      opener: doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null
    };
    doc.body.appendChild(root);
    doc.addEventListener('keydown', onKeydown);
    // 破坏性操作默认把焦点给安全项：随手一个回车不该把数据清了
    cancel.focus();
  }

  App.ui = {
    el: el,
    toast: toast,
    confirmDialog: confirmDialog,
    formatTime: formatTime,
    formatPercent: formatPercent,
    switchControl: switchControl,
    faceText: function (face) { return face === 'tails' ? '反面' : '正面'; },
    faceShort: function (face) { return face === 'tails' ? '反' : '正'; },
    clear: function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  };
})(window);
