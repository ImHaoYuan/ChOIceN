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
  doc.documentElement = doc;
  doc.documentElement.style = new Proxy({ setProperty() {}, removeProperty() {} }, { set(t, k, v) { t[k] = v; return true; } });
  const registry = {
    view: new Element('main'),
    navList: new Element('nav'),
    toast: new Element('div'),
    soundToggle: new Element('button'),
    soundIcon: new Element('span'),
    resetStats: new Element('button'),
    themeToggle: new Element('button'),
    themeIcon: new Element('span'),
    themeText: new Element('span'),
    // 随机源已从页面最下方的分段控件改成顶部栏的循环切换按钮
    sourceToggle: new Element('button'),
    sourceIcon: new Element('span'),
    sourceName: new Element('span'),
    // 「更多选项」下拉：按钮 + 面板（慢动作 / 显示随机源两个开关由 app.js 注入）
    moreMenu: new Element('div'),
    moreToggle: new Element('button'),
    morePanel: Object.assign(new Element('div'), { hidden: true })
  };
  registry.soundToggle.appendChild(Object.assign(new Element('span'), { className: 'icon-btn__text' }));
  registry.themeToggle.appendChild(Object.assign(new Element('span'), { className: 'icon-btn__icon' }));
  registry.themeToggle.appendChild(Object.assign(new Element('span'), { className: 'icon-btn__text' }));
  registry.resetStats.appendChild(Object.assign(new Element('span'), { className: 'icon-btn__text' }));
  registry.sourceToggle.appendChild(registry.sourceIcon);
  registry.sourceToggle.appendChild(registry.sourceName);
  registry.moreMenu.appendChild(registry.moreToggle);
  registry.moreMenu.appendChild(registry.morePanel);
  doc.body = new Element('body');
  doc.head = new Element('head');
  // 主题切换会同步浏览器地址栏配色用的 meta
  doc.head.appendChild(Object.assign(new Element('meta'), { name: 'theme-color' }));
  doc.querySelector = Element.prototype.querySelector.bind(doc.head);
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
  Uint32Array,
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
  // 用假 crypto 覆盖「系统加密随机」分支：Node 里没有浏览器的 crypto，
  // 这里给一个 LCG 实现，既能验证 crypto/hybrid 路径被真正走到，
  // 又能保证输出可复现（均值仍接近 0.5）。
  crypto: {
    _n: 0x12345678,
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) {
        this._n = (Math.imul(this._n, 1664525) + 1013904223) >>> 0;
        arr[i] = this._n;
      }
      return arr;
    }
  },
  confirm: () => true,
  alert: () => {},
  setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; },
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 8),
  cancelAnimationFrame: (id) => clearTimeout(id),
  scrollTo: () => {},
  // 记录 window 级监听（app.js 在这里挂 hashchange），这样测试能模拟路由切换
  addEventListener: (type, fn) => {
    (sandbox._winListeners[type] = sandbox._winListeners[type] || []).push(fn);
  },
  removeEventListener: (type, fn) => {
    const l = sandbox._winListeners[type] || [];
    const i = l.indexOf(fn);
    if (i > -1) l.splice(i, 1);
  },
  _winListeners: {},
  dispatch: function (type, event) {
    const ev = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, event);
    (sandbox._winListeners[type] || []).slice().forEach((fn) => fn(ev));
    return ev;
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.AudioContext = undefined;    // 音频静默降级

const files = ['rng.js', 'store.js', 'audio.js', 'theme.js', 'ui.js', 'coin.js', 'modes.js', 'app.js'];
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

console.log('\n[2] 随机源（混合 / 加密 / 时间）');
check('检测到 crypto（测试用假实现）', App.rng.hasCrypto === true);
check('默认随机源为混合', App.rng.getSource() === 'hybrid', App.rng.getSource());

for (const name of ['hybrid', 'crypto', 'time']) {
  const label = App.rng.SOURCE_LABEL[name].name;
  App.rng.setSource(name);
  check(`可切换到「${label}」源`, App.rng.getSource() === name, App.rng.getSource());

  const list = [];
  for (let i = 0; i < 4000; i++) list.push(App.rng.float());
  const inRange = list.every((v) => v >= 0 && v < 1);
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const sides = { heads: 0, tails: 0 };
  // 连续直接调用 side()（中间不夹 float()），确保 side() 自己消耗随机数，
  // 而不是回读上一次的陈旧位
  for (let i = 0; i < 4000; i++) sides[App.rng.side()]++;
  const burst = new Set();
  for (let i = 0; i < 200; i++) burst.add(App.rng.float());
  const info = App.rng.info();

  check(`  [${label}] 随机数全部落在 [0,1)`, inRange);
  check(`  [${label}] 均值接近 0.5`, Math.abs(mean - 0.5) < 0.02, `mean=${mean.toFixed(4)}`);
  check(`  [${label}] 正反面比例均衡`, Math.abs(sides.heads - sides.tails) < 200,
    `heads=${sides.heads} tails=${sides.tails}`);
  check(`  [${label}] 同毫秒连抛无重复`, burst.size > 190, `unique=${burst.size}/200`);
  check(`  [${label}] info().source 与实际使用一致`, info.source === name, info.source);
}

// crypto 源必须真的走系统随机数，而不是「混了一点时间熵」
App.rng.setSource('crypto');
const c1 = App.rng.info().cryptoWords;
App.rng.float();
const ci = App.rng.info();
check('crypto 源消耗系统随机数', ci.cryptoWords > c1, `${c1} → ${ci.cryptoWords}`);
check('crypto 源输出直接取自系统随机数（未再混时间熵）', ci.raw === ci.crypto,
  `raw=0x${ci.raw.toString(16)} crypto=0x${ci.crypto.toString(16)}`);

// time 源必须完全不碰 crypto
App.rng.setSource('time');
const t1 = App.rng.info().cryptoWords;
for (let i = 0; i < 100; i++) App.rng.float();
check('time 源不消耗系统随机数', App.rng.info().cryptoWords === t1,
  `cryptoWords=${App.rng.info().cryptoWords}`);

// hybrid 源两者都用
App.rng.setSource('hybrid');
const h1 = App.rng.info().cryptoWords;
App.rng.float();
const hi = App.rng.info();
check('hybrid 源同时使用系统随机数', hi.cryptoWords > h1, `${h1} → ${hi.cryptoWords}`);
check('hybrid 源信息来源标记为 hybrid', hi.source === 'hybrid', hi.source);

// 切换要通知订阅者（顶部栏标签依赖它）
let srcFired = 0;
const offSrc = App.rng.onChange(() => { srcFired++; });
App.rng.setSource('crypto');
App.rng.setSource('time');
offSrc();
App.rng.setSource('hybrid');
check('随机源变化回调正常（退订后不再触发）', srcFired === 2, `fired=${srcFired}`);

// 顶部栏随机源按钮随所选源变化（它现在是按钮，不是静态标签）
check('顶部栏随机源按钮已同步', doc._registry.sourceName.textContent === '混合',
  doc._registry.sourceName.textContent);
App.rng.setSource('crypto');
check('切换后顶部栏按钮文案跟着变', doc._registry.sourceName.textContent === '加密',
  doc._registry.sourceName.textContent);
check('切换后顶部栏按钮图标跟着变', doc._registry.sourceIcon.textContent === '🔐',
  doc._registry.sourceIcon.textContent);
App.rng.setSource('hybrid');

/*
 * 顶部栏的随机源按钮：点按循环 混合 → 加密 → 时间 → 混合。
 * 这是这次改动的核心交互，所以三步都点满一圈，确认能回到默认值。
 */
{
  const btn = doc._registry.sourceToggle;
  const nameOf = () => doc._registry.sourceName.textContent;
  check('随机源按钮初始为混合', App.rng.getSource() === 'hybrid' && nameOf() === '混合',
    `${App.rng.getSource()} / ${nameOf()}`);

  btn.click();
  check('第 1 次点击 → 加密', App.rng.getSource() === 'crypto' && nameOf() === '加密',
    `${App.rng.getSource()} / ${nameOf()}`);
  check('随机源写入偏好', App.store.getSettings().rngSource === 'crypto',
    App.store.getSettings().rngSource);

  btn.click();
  check('第 2 次点击 → 时间', App.rng.getSource() === 'time' && nameOf() === '时间',
    `${App.rng.getSource()} / ${nameOf()}`);

  btn.click();
  check('第 3 次点击 → 回到默认的混合', App.rng.getSource() === 'hybrid' && nameOf() === '混合',
    `${App.rng.getSource()} / ${nameOf()}`);
  check('回到默认后偏好也已更新', App.store.getSettings().rngSource === 'hybrid',
    App.store.getSettings().rngSource);

  // 按钮的 title 要能说清当前用的是哪一种（窄屏只留图标，就靠它了）
  check('按钮 title 含当前源名与说明',
    btn.title.indexOf('混合') > -1 && btn.title.indexOf('时间熵') > -1, btn.title);

  /*
   * 面板上的「随机源」必须立刻反映当前选择。
   * info().source 是「上一次取值实际走的路径」，切换源后还没取值时它仍是旧值，
   * 只显示它就会出现「按钮已经切到加密、面板还写着混合」的不一致，所以两者分开显示。
   * 这次改动把切换入口搬到了顶部栏，这条联动更容易被漏掉，故保留断言。
   */
  const cells = view.querySelectorAll('.entropy__item');
  const cell = (label) => {
    const hit = cells.find((it) => it.textContent.trim().indexOf(label) === 0);
    return hit ? hit.querySelector('b').textContent : null;
  };
  check('顶部栏切换后面板「随机源」立即显示新源', cell('随机源') === '混合', String(cell('随机源')));
  App.rng.setSource('crypto');
  check('再次切换后面板「随机源」仍跟着变', cell('随机源') === '加密', String(cell('随机源')));
  check('面板另有「本次取值」记录上一次实际路径',
    ['混合', '加密', '时间'].indexOf(cell('本次取值')) > -1, String(cell('本次取值')));
  App.rng.setSource('hybrid');
  check('切回后面板「随机源」也跟着回来', cell('随机源') === '混合', String(cell('随机源')));
}

/*
 * 页面最下方的设置面板应该已经整个移除：
 * 主题、随机源、慢动作、显示随机源 现在都在顶部栏。
 */
check('页面里不再有 .settings 设置面板', view.querySelectorAll('.settings').length === 0);
check('页面里不再有随机源分段控件 .seg', view.querySelectorAll('.seg').length === 0);
check('页面里不再有底层主题切换行 .setting-item', view.querySelectorAll('.setting-item').length === 0);

// 没有 crypto 的环境必须自动降级为 time，且不能抛错
{
  const noCrypto = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean,
    Uint32Array, performance,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };
  noCrypto.window = noCrypto;
  noCrypto.globalThis = noCrypto;
  noCrypto.crypto = undefined;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'rng.js'), 'utf8'), noCrypto,
    { filename: 'rng-no-crypto.js' });
  const R = noCrypto.App.rng;
  check('无 crypto 时 hasCrypto 为 false', R.hasCrypto === false);
  check('无 crypto 时默认源降级为 time', R.getSource() === 'time', R.getSource());
  R.setSource('crypto');
  check('无 crypto 时请求加密源会降级而不报错', R.getSource() === 'time', R.getSource());
  // 顶部栏那个按钮就是靠 cycle() 工作的：没有 crypto 时必须原地不动，
  // 而不是切到一个并不存在的「加密」上
  check('无 crypto 时循环切换停在 time',
    R.cycle() === 'time' && R.getSource() === 'time', R.getSource());
  const v = R.float();
  check('无 crypto 时仍能正常取值', v >= 0 && v < 1, String(v));
  const vv = [];
  for (let i = 0; i < 500; i++) vv.push(R.float());
  const m = vv.reduce((a, b) => a + b, 0) / vv.length;
  check('无 crypto 时均值仍接近 0.5', Math.abs(m - 0.5) < 0.05, `mean=${m.toFixed(4)}`);
}

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

// 3.3 单次抛掷必须仍是原速（连抛加速不能影响单次）
{
  const t0 = Date.now();
  flipBtn.click();
  await sleep(3300);
  const took = Date.now() - t0;
  check('单次抛掷仍为原速（约 2.5s，未被加速影响）', took > 2400 && took < 3400, `${took}ms`);
}

// 3.4 再抛 3 次，配合 [4] 的连抛确认结果不会恒定（曾出现过恒为正面的缺陷）
for (let i = 0; i < 3; i++) { flipBtn.click(); await sleep(3100); }
check('连续单次抛掷累计 5 次', App.store.getStats().total === 5, `total=${App.store.getStats().total}`);

console.log('\n[4] 连抛与统计展示');
const tenBtn = view.querySelectorAll('.btn').find((b) => b.textContent.includes('连抛'));
check('找到「连抛 10 次」按钮', !!tenBtn);
if (tenBtn) {
  const t0 = Date.now();
  tenBtn.click();
  // 加速后 10 次约 10 秒；原速需要 27 秒以上，所以这里最多等 40 秒
  let waited = 0;
  while (App.store.getStats().total < 15 && waited < 40000) {
    await sleep(200);
    waited += 200;
  }
  const took = Date.now() - t0;
  const s2 = App.store.getStats();
  check('连抛 10 次全部完成', s2.total === 15, `total=${s2.total} 用时=${took}ms`);
  check('连抛动画已加速（明显快于原速 27s）', took < 20000, `${took}ms`);
  check('连抛不是瞬间完成（动画确实播完了）', took > 4000, `${took}ms`);
  check('正 + 反 = 总数', s2.heads + s2.tails === s2.total);
  check('历史长度 15', App.store.getHistory().length === 15);
  check('两种结果都出现过（不会恒定一面）', s2.heads > 0 && s2.tails > 0,
    `heads=${s2.heads} tails=${s2.tails}`);
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

console.log('\n[6] 深浅主题');
{
  const T = App.theme;
  check('theme 模块已加载', !!T && typeof T.themeByTime === 'function');

  // 时间判定：08:00–17:59 浅色，其余深色
  const at = (h, m) => new Date(2026, 0, 15, h, m || 0, 0);
  const table = [
    [0, 'dark'], [7, 'dark'], [7.99, 'dark'], [8, 'light'], [12, 'light'],
    [17, 'light'], [17.99, 'light'], [18, 'dark'], [23, 'dark']
  ];
  const wrong = table.filter(([h, want]) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return T.themeByTime(at(hh, mm)) !== want;
  });
  check('按时间判定正确（8:00–18:00 浅色）', wrong.length === 0,
    wrong.length ? JSON.stringify(wrong) : '');

  check('早上 9 点 → 浅色', T.themeByTime(at(9)) === 'light');
  check('晚上 21 点 → 深色', T.themeByTime(at(21)) === 'dark');
  check('auto 模式解析为时间结果',
    T.resolve('auto') === T.themeByTime(new Date()));

  // 两种固定模式
  T.setMode('light');
  check('固定浅色生效', T.get() === 'light' && doc.getAttribute('data-theme') === 'light');
  T.setMode('dark');
  check('固定深色生效', T.get() === 'dark' && doc.getAttribute('data-theme') === 'dark');

  // 循环切换：auto → light → dark → auto
  T.setMode('auto');
  const seq = [T.getMode()];
  seq.push((T.toggle(), T.getMode()));
  seq.push((T.toggle(), T.getMode()));
  seq.push((T.toggle(), T.getMode()));
  check('点按循环 auto→light→dark→auto',
    seq.join('>') === 'auto>light>dark>auto', seq.join('>'));

  // 模式持久化
  T.setMode('light');
  check('模式写入偏好', App.store.getSettings().theme === 'light');

  // 变化回调
  let fired = 0;
  const off = T.onChange(() => { fired++; });
  T.setMode('dark');
  T.setMode('light');
  off();
  T.setMode('dark');
  check('主题变化回调正常（退订后不再触发）', fired === 2, `fired=${fired}`);

  // 顶部栏按钮已同步
  const btn = doc._registry.themeToggle;
  const btnText = () => btn.querySelector('.icon-btn__text').textContent;
  check('顶部栏主题按钮已同步',
    btn.dataset.mode === 'dark' && btnText() === '深色',
    `mode=${btn.dataset.mode} text=${btnText()}`);
  check('按钮点击可切换主题', (() => {
    const before = T.getMode();
    btn.click();
    return T.getMode() !== before;
  })());

  /*
   * 回归：切回 auto 时，若「时间解析出的外观」与上一次固定模式的外观相同，
   * 按钮也必须跟着变回「跟随时间」。
   * 曾经的 bug：apply() 只在 resolved !== current 时才通知，
   * 于是模式已经变成 auto、外观却和上一次一样，界面收不到通知，
   * 顶部栏停在固定模式的名字上，而弹窗（即时计算）显示「跟随时间」，两者不一致。
   *
   * 这个场景必须「构造」出来，不能依赖跑测试时的真实时间：
   * 曾经写成固定先切到 dark 再 toggle 回 auto，结果白天跑时 auto 解析成 light，
   * 前提不成立，测试随机失败。
   * 而且中间那一步必须真的发生过一次外观变化，按钮才会停在固定模式的名字上，
   * 否则最后一步「按钮恰好还是跟随时间」，测试会因为巧合而通过（验证过，确实会漏）。
   * 所以这里的顺序是：
   *   ① 切到「与时间判定相反」的固定模式（外观变了 → 必然同步）
   *   ② 切到「与时间判定相同」的固定模式（外观又变了 → 按钮显示这个固定模式的名字）
   *   ③ 切回 auto（模式变了、外观没变）→ 命中 bug
   */
  const autoNow = T.themeByTime(new Date());            // auto 现在解析成 light 还是 dark
  const otherMode = autoNow === 'light' ? 'dark' : 'light';
  const labelOf = (m) => (m === 'light' ? '浅色' : '深色');

  T.setMode(otherMode);
  check('先切到与时间判定相反的固定模式', btnText() === labelOf(otherMode),
    `text=${btnText()} want=${labelOf(otherMode)}`);
  T.setMode(autoNow);
  const startTheme = T.get();
  check('再切到与时间判定相同的固定模式', btnText() === labelOf(autoNow),
    `text=${btnText()} want=${labelOf(autoNow)}`);

  T.setMode('auto');                                    // ← 模式变了，外观与上一步相同
  check('切回 auto 后模式为 auto', T.getMode() === 'auto');
  check('切回 auto 且外观未变时，按钮文字仍会更新为「跟随时间」',
    btnText() === '跟随时间' && btn.dataset.mode === 'auto',
    `text=${btnText()} data-mode=${btn.dataset.mode} get=${T.get()} autoNow=${autoNow}`);
  check('切回 auto 且外观未变时，外观保持不变（不闪烁）',
    T.get() === startTheme, `get=${T.get()} start=${startTheme}`);
  check('按钮文字与弹窗文案一致', (() => {
    const toastText = '主题：' + T.label().name;
    return toastText === '主题：' + btnText();
  })(), `按钮=${btnText()}`);

  // 模式变了、外观也变了的情况同样要通知（选与时间判定不同的那个固定模式）
  T.setMode(otherMode);
  check('固定模式与时间判定不同时，按钮与外观都同步',
    btnText() === labelOf(otherMode) && btn.dataset.mode === otherMode && T.get() === otherMode,
    `text=${btnText()} mode=${btn.dataset.mode} get=${T.get()}`);

  T.setMode('auto');
  check('回到 auto 后按钮与模式一致',
    T.getMode() === 'auto' && btnText() === '跟随时间' && btn.dataset.mode === 'auto');

  // 刷新页面后（重新 init）也应保持 auto，而不是掉回上一次的固定模式
  const persisted = App.store.getSettings().theme;
  check('auto 模式已持久化', persisted === 'auto', `saved=${persisted}`);
  T.init(persisted);
  check('重新 init 后仍是跟随时间',
    T.getMode() === 'auto' && btnText() === '跟随时间',
    `mode=${T.getMode()} text=${btnText()}`);
}

console.log('\n[7] 存储与重置');
check('localStorage 写入成功', storage.size > 0, `keys=${[...storage.keys()].join(', ')}`);
App.store.resetStats();
const cleared = App.store.getStats();
check('统计已清空', cleared.total === 0 && cleared.heads === 0 && cleared.tails === 0);
check('历史已清空', App.store.getHistory().length === 0);

// 「清空统计」按钮已从侧边栏移到顶部栏，这里验证它仍然可用
{
  App.store.record('heads');
  App.store.pushHistory({ face: 'heads', at: Date.now() });
  check('按钮点击前有数据', App.store.getStats().total === 1);
  doc._registry.resetStats.click();
  check('顶部栏「清空统计」按钮生效',
    App.store.getStats().total === 0 && App.store.getHistory().length === 0,
    `total=${App.store.getStats().total} history=${App.store.getHistory().length}`);
}

console.log('\n[8] 顶部栏：更多选项下拉与开关');
{
  const R = doc._registry;
  const panel = R.morePanel;
  const btn = R.moreToggle;

  check('下拉面板初始为收起', panel.hidden === true &&
    btn.getAttribute('aria-expanded') === 'false',
    `hidden=${panel.hidden} aria-expanded=${btn.getAttribute('aria-expanded')}`);

  const sws = panel.querySelectorAll('.switch');
  check('下拉面板里有 2 个开关', sws.length === 2, `count=${sws.length}`);
  check('两个开关分别是「慢动作」「显示随机源」',
    sws.map((s) => s.textContent.trim()).join(' / ') === '慢动作 / 显示随机源',
    sws.map((s) => s.textContent.trim()).join(' / '));

  btn.click();
  check('点「更多选项」展开', panel.hidden === false &&
    btn.getAttribute('aria-expanded') === 'true', `hidden=${panel.hidden}`);
  check('展开时容器加上 menu--open（用于高亮按钮）',
    R.moreMenu.classList.contains('menu--open'));

  btn.click();
  check('再点一次收起', panel.hidden === true &&
    btn.getAttribute('aria-expanded') === 'false', `hidden=${panel.hidden}`);

  btn.click();
  doc.dispatch('click');
  check('点面板外任意处收起', panel.hidden === true, `hidden=${panel.hidden}`);

  btn.click();
  doc.dispatch('keydown', { key: 'Escape' });
  check('按 Esc 收起', panel.hidden === true &&
    btn.getAttribute('aria-expanded') === 'false', `hidden=${panel.hidden}`);

  /*
   * 注意：本文件的 DOM 桩不实现事件冒泡，所以「点按钮不会顺手把面板关掉」
   * 这条只能靠真实浏览器验证（app.js 里点了 stopPropagation）。
   * 这里能验的是面板自身的开合状态机。
   */

  // ---- 开关 1：慢动作要让硬币动画真的变慢 ----
  const inputs = panel.querySelectorAll('input');
  check('面板里有 2 个 checkbox 输入', inputs.length === 2, `count=${inputs.length}`);
  const slowInput = inputs[0];
  const entInput = inputs[1];

  check('慢动作开关的初始状态与偏好一致',
    slowInput.checked === !!App.store.getSettings().slowMotion,
    `checked=${slowInput.checked}`);

  slowInput.checked = true;
  slowInput.dispatch('change');
  check('打开慢动作后写入偏好', App.store.getSettings().slowMotion === true,
    String(App.store.getSettings().slowMotion));
  const coinA = sandbox.__coin;
  check('打开慢动作后硬币速度系数变为 1.8',
    coinA && coinA.getSpeedFactor() === 1.8,
    coinA ? String(coinA.getSpeedFactor()) : 'no coin');

  slowInput.checked = false;
  slowInput.dispatch('change');
  check('关闭慢动作后速度系数回到 1',
    sandbox.__coin && sandbox.__coin.getSpeedFactor() === 1,
    String(sandbox.__coin && sandbox.__coin.getSpeedFactor()));
  check('关闭慢动作后偏好也已更新', App.store.getSettings().slowMotion === false);

  // ---- 开关 2：显示随机源要能隐藏页面里的随机源面板 ----
  const entropy = view.querySelector('.entropy');
  check('随机源面板初始可见', !!entropy && entropy.hidden === false,
    entropy ? `hidden=${entropy.hidden}` : 'no .entropy');

  entInput.checked = false;
  entInput.dispatch('change');
  check('关闭「显示随机源」后页面里的面板隐藏', entropy.hidden === true,
    `hidden=${entropy.hidden}`);
  check('显示随机源写入偏好', App.store.getSettings().showEntropy === false);

  entInput.checked = true;
  entInput.dispatch('change');
  check('重新打开后面板恢复显示', entropy.hidden === false, `hidden=${entropy.hidden}`);

  /*
   * 订阅必须能退订：顶部栏的开关是「一次改动广播给所有订阅者」，
   * 视图销毁时若忘了退订，每切一次功能就多堆积一个订阅者，
   * 已经销毁的视图还会继续被通知（去操作一个已经不存在的硬币）。
   *
   * 这里挂一个探针功能占住当前视图，然后改设置：
   *  - 探针（当前视图）必须收到 1 次；
   *  - 被销毁的硬币视图必须一次都不收到 —— 用「旧硬币的速度系数有没有被改动」来判断。
   *    注意不能只数探针的命中次数：泄漏的订阅者操作的是硬币，不会增加探针的计数，
   *    那样写出来的断言是假的（第一版就是这么写的，变异测试证明它抓不住漏退订）。
   */
  {
    const poppedCoin = sandbox.__coin;      // 即将被销毁的那个硬币视图持有的硬币
    let hits = 0;
    App.modes.list.push({
      id: 'probe-settings', icon: '🧪', name: '订阅探针', desc: '仅测试用', available: true,
      mount(root, probeCtx) {
        const off = probeCtx.onSetting(() => { hits++; });
        root.appendChild(App.ui.el('div.probe'));
        return function destroy() { off(); };
      }
    });

    sandbox.location.hash = '#/probe-settings';
    sandbox.dispatch('hashchange');
    check('已切换到探针功能', view.querySelector('.probe') !== null);

    const inp = panel.querySelectorAll('input')[0];
    const base = hits;
    inp.checked = true;
    inp.dispatch('change');
    check('当前视图能收到顶部栏广播的偏好变化', hits === base + 1, `hits=+${hits - base}`);
    check('已销毁的硬币视图不再收到广播（destroy 里退订生效）',
      poppedCoin.getSpeedFactor() === 1,
      `destroyed coin speed=${poppedCoin.getSpeedFactor()}`);

    // 切回 coin：探针销毁后同样不该再收到
    sandbox.location.hash = '#/coin';
    sandbox.dispatch('hashchange');
    const after = hits;
    inp.checked = false;
    inp.dispatch('change');
    check('切回硬币后探针已退订，不再收到广播', hits === after, `hits=+${hits - after}`);
    check('新挂载的硬币视图收到了这次设置',
      sandbox.__coin && sandbox.__coin.getSpeedFactor() === 1,
      String(sandbox.__coin && sandbox.__coin.getSpeedFactor()));

    App.modes.list.pop();
    check('探针功能已从注册表移除', App.modes.get('probe-settings') === null);
    check('切来切去之后视图里仍是硬币', view.querySelector('.entropy') !== null);
  }
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}\n`);
process.exit(failures === 0 ? 0 : 1);
