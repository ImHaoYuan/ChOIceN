/* =============================================================
   smoke-test.mjs — 无浏览器冒烟测试
   用最小 DOM 桩加载全部前端脚本，验证：
     · 页面能挂载（无运行时异常）
     · 点击「抛一次」能产生 heads/tails 结果并写入统计与历史
     · 路由切换 / 占位功能可渲染
   运行： node smoke-test.mjs
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/* ---------------- 最小 DOM 实现 ---------------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this.#sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this.#sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    if (on === undefined) on = !this.set.has(c);
    if (on) this.set.add(c); else this.set.delete(c);
    this.#sync();
    return !!on;
  }
  #sync() { this.el._className = [...this.set].join(' '); }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, { set(t, k, v) { t[k] = v; return true; } });
    this.listeners = {};
    this._text = '';
    this._className = '';
    this.classList = new ClassList(this);
    this.nodeType = 1;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = v; this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  // 简化版 innerHTML：只支持本项目用到的标签/属性（div、span、class、id、data-*）
  set innerHTML(html) {
    this.children = [];
    this._text = '';
    parseHTML(String(html), this);
  }
  get innerHTML() { return this._text; }
  appendChild(child) {
    if (child == null) return child;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i > -1) this.children.splice(i, 1);
    return child;
  }
  insertBefore(child) { return this.appendChild(child); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = v;
    if (k === 'id') this.id = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v);
    if (k === 'disabled') this.disabled = true;
  }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type] || [];
    const i = l.indexOf(fn);
    if (i > -1) l.splice(i, 1);
  }
  dispatch(type, event = {}) {
    const ev = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, event);
    (this.listeners[type] || []).forEach((fn) => fn(ev));
    return ev;
  }
  click() { this.dispatch('click', { target: this }); }
  querySelectorAll(sel) { return findBySelector(this, sel); }
  querySelector(sel) { return findBySelector(this, sel)[0] || null; }
  get offsetWidth() { return 100; }
  scrollIntoView() {}
  focus() {}
  walk(fn) { fn(this); this.children.forEach((c) => c.walk && c.walk(fn)); }
}

function matches(el, sel) {
  return sel.split(',').some((one) => {
    const s = one.trim();
    if (s.startsWith('.')) return el.classList.contains(s.slice(1));
    if (s.startsWith('#')) return el.id === s.slice(1);
    return el.tagName === s.toUpperCase();
  });
}

function findBySelector(root, sel) {
  const out = [];
  root.walk((n) => { if (n !== root && matches(n, sel)) out.push(n); });
  return out;
}

/** 简化 HTML 解析：支持 <tag attr="v"> 与文本，够本项目用 */
function parseHTML(html, parent) {
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)\/?>/g;
  let last = 0;
  let m;
  const stack = [parent];
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(last, m.index);
    if (text.trim()) {
      const top = stack[stack.length - 1];
      top.appendChild(Object.assign(new Element('#text'), { nodeType: 3, textContent: text }));
    }
    last = tagRe.lastIndex;
    if (m[1] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = new Element(m[2]);
    const attrs = m[3] || '';
    const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = attrRe.exec(attrs)) !== null) {
      if (!a[1]) continue;
      if (a[1] === 'class') node.className = a[2] || '';
      else node.setAttribute(a[1], a[2] == null ? '' : a[2]);
    }
    stack[stack.length - 1].appendChild(node);
    stack.push(node);
  }
  const tail = html.slice(last);
  if (tail.trim()) {
    stack[stack.length - 1].appendChild(
      Object.assign(new Element('#text'), { nodeType: 3, textContent: tail })
    );
  }
  return parent;
}

function makeDocument() {
  const doc = new Element('html');
  doc.readyState = 'complete';
  const registry = {
    view: new Element('main'),
    navList: new Element('nav'),
    toast: new Element('div'),
    soundToggle: new Element('button'),
    soundIcon: new Element('span'),
    resetStats: new Element('button')
  };
  registry.soundToggle.appendChild(Object.assign(new Element('span'), { className: 'icon-btn__text' }));
  doc.body = new Element('body');
  doc.head = new Element('head');
  doc.documentElement = doc;
  doc.getElementById = (id) => registry[id] || null;
  doc.createElement = (tag) => new Element(tag);
  doc.createTextNode = (t) => Object.assign(new Element('#text'), { _text: String(t), nodeType: 3, textContent: String(t) });
  doc.addEventListener = Element.prototype.addEventListener.bind(doc);
  doc.removeEventListener = Element.prototype.removeEventListener.bind(doc);
  doc.dispatch = Element.prototype.dispatch.bind(doc);
  doc.listeners = {};
  doc._registry = registry;
  return doc;
}

/* ---------------- 运行环境 ---------------- */
const doc = makeDocument();
const storage = new Map();
const timers = [];

const sandbox = {
  console,
  performance,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Promise,
  Set,
  Map,
  Error,
  Uint8Array,
  parseInt,
  parseFloat,
  isNaN,
  document: doc,
  navigator: { userAgent: 'node-smoke' },
  location: {
    hash: '#/coin',
    replace(h) { this.hash = h; },
    href: 'http://localhost/#/coin'
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  },
  crypto: undefined,                       // 走纯时间熵分支
  confirm: () => true,
  alert: () => {},
  setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; },
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 8),
  cancelAnimationFrame: (id) => clearTimeout(id),
  scrollTo: () => {},
  addEventListener: () => {},
  removeEventListener: () => {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.AudioContext = undefined;    // 音频静默降级

const files = ['rng.js', 'store.js', 'audio.js', 'ui.js', 'coin.js', 'modes.js', 'app.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: f });
}

/* ---------------- 断言辅助 ---------------- */
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}

const App = sandbox.App;
const view = doc._registry.view;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coinProbe = sandbox.__coin;

/* ---------------- 测试 ---------------- */
console.log('\n[1] 启动与挂载');
await sleep(40);
check('App 命名空间就绪', !!App && !!App.rng && !!App.store && !!App.modes);
check('默认视图已渲染（含 h1）', view.querySelector('h1') !== null);
check('硬币实例已挂载', !!coinProbe);
check('侧边导航渲染出 4 个功能卡片', doc._registry.navList.querySelectorAll('.mode-card').length === 4);
check('当前功能为 coin', doc._registry.navList.querySelectorAll('.mode-card').filter((c) => c.getAttribute('aria-current') === 'true').length === 1);

console.log('\n[2] 时间随机源');
const samples = [];
for (let i = 0; i < 4000; i++) samples.push(App.rng.float());
const inRange = samples.every((v) => v >= 0 && v < 1);
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const sides = { heads: 0, tails: 0 };
// 连续直接调用 side()（中间不夹 float()），确保 side() 自己消耗随机数
// 而不是回读上一次的陈旧位
for (let i = 0; i < 4000; i++) sides[App.rng.side()]++;
check('随机数全部落在 [0,1)', inRange);
check('均值接近 0.5', Math.abs(mean - 0.5) < 0.02, `mean=${mean.toFixed(4)}`);
check('正反面比例均衡', Math.abs(sides.heads - sides.tails) < 200, `heads=${sides.heads} tails=${sides.tails}`);
const burst = new Set();
for (let i = 0; i < 200; i++) burst.add(App.rng.float());
check('同毫秒连抛无重复', burst.size > 190, `unique=${burst.size}/200`);

console.log('\n[3] 抛硬币交互');
const flipBtn = view.querySelector('.btn--primary');
check('找到「抛一次」按钮', flipBtn !== null);

// 3.1 币面切换逻辑：角度 → 可见币面（不依赖渲染器）
{
  const probe = App.createCoin({ initialFace: 'heads' });
  const cases = [[0, 'heads'], [45, 'heads'], [89, 'heads'], [91, 'tails'],
                 [180, 'tails'], [269, 'tails'], [271, 'heads'], [359, 'heads']];
  const wrong = cases.filter(([deg, want]) => probe.renderAngle(deg) !== want);
  check('按角度切换币面正确', wrong.length === 0, wrong.length ? JSON.stringify(wrong) : '');
  probe.show('tails');
  check('show(tails) 后可见反面', probe.visibleFace() === 'tails');
  probe.show('heads');
  check('show(heads) 后可见正面', probe.visibleFace() === 'heads');
  probe.destroy();
}

App.store.resetStats();
const before = App.store.getStats().total;
flipBtn.click();
await sleep(60);
check('抛掷中按钮被禁用', flipBtn.disabled === true);
await sleep(4200);
const stats = App.store.getStats();
const history = App.store.getHistory();
check('统计 +1', stats.total === before + 1, `total=${stats.total}`);
check('历史记录写入', history.length === 1 && ['heads', 'tails'].includes(history[0].face), JSON.stringify(history[0]));
check('按钮恢复可用', flipBtn.disabled === false);
const statusText = view.querySelector('.stage__status-main').textContent;
check('结果文案已更新', /正面|反面/.test(statusText), statusText);

// 3.2 落定后硬币必须停在结果对应的那一面
{
  const face = history[0].face;
  const angle = coinProbe.currentAngle();
  const wantAngle = face === 'tails' ? 180 : 0;
  check('落定角度与结果一致', Math.abs(((angle - wantAngle) % 360 + 360) % 360) < 0.01 || Math.abs(((angle - wantAngle) % 360 + 360) % 360 - 360) < 0.01, `angle=${angle} want=${wantAngle}`);
  check('落定后显示的就是结果那一面', coinProbe.visibleFace() === face, `visible=${coinProbe.visibleFace()} face=${face}`);
}

// 3.3 再抛 13 次，确认结果不会恒定（曾出现过恒为正面的缺陷）
for (let i = 0; i < 13; i++) { flipBtn.click(); await sleep(3600); }
const s3 = App.store.getStats();
check('多次抛掷两种结果都出现', s3.heads > 0 && s3.tails > 0, `heads=${s3.heads} tails=${s3.tails}`);

console.log('\n[4] 连抛与统计展示');
const tenBtn = view.querySelectorAll('.btn').find((b) => b.textContent.includes('连抛'));
check('找到「连抛 10 次」按钮', !!tenBtn);
if (tenBtn) {
  tenBtn.click();
  await sleep(60000);
  const s2 = App.store.getStats();
  check('累计 24 次', s2.total === 24, `total=${s2.total}`);
  check('正 + 反 = 总数', s2.heads + s2.tails === s2.total);
  check('历史长度 24', App.store.getHistory().length === 24);
}

console.log('\n[5] 路由与占位功能');
const hashListeners = [];
sandbox.location.replace = function (h) { this.hash = h; };
App.modes.list.slice(1).forEach((m) => {
  check(`占位功能 ${m.id} 存在于注册表且标记未开放`, m.available === false);
});
App.modes.list.slice(1).forEach((m) => {
  const probe = new Element('main');
  m.mount(probe, { setActions() {}, isActive: () => true });
  check(`占位功能 ${m.id} 可渲染`, probe.querySelector('.placeholder') !== null);
});

console.log('\n[6] 存储与重置');
check('localStorage 写入成功', storage.size > 0, `keys=${[...storage.keys()].join(', ')}`);
App.store.resetStats();
const cleared = App.store.getStats();
check('统计已清空', cleared.total === 0 && cleared.heads === 0 && cleared.tails === 0);
check('历史已清空', App.store.getHistory().length === 0);

console.log(`\n${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}\n`);
process.exit(failures === 0 ? 0 : 1);
