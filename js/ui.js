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

  App.ui = {
    el: el,
    toast: toast,
    formatTime: formatTime,
    formatPercent: formatPercent,
    faceText: function (face) { return face === 'tails' ? '反面' : '正面'; },
    faceShort: function (face) { return face === 'tails' ? '反' : '正'; },
    clear: function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  };
})(window);
