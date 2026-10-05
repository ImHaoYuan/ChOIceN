/* check-inline-theme.mjs — 校验 index.html <head> 里的首屏防闪脚本
   与 js/theme.js 的时间规则是否一致。
   两处必须同步，否则会出现「首屏一种主题、脚本跑起来又换一种」的闪烁。

   做法：把内联脚本里的判定表达式换成主题模块的实现，再对比两边的结果。
   运行： node check-inline-theme.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const themeJs = fs.readFileSync(path.join(ROOT, 'js', 'theme.js'), 'utf8');

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

console.log('\n[首屏防闪脚本与 theme.js 的一致性]');

// 1) 内联脚本存在且在样式表之前
const inlineMatch = html.match(/<script>([\s\S]*?)<\/script>/);
check('index.html 含内联主题脚本', !!inlineMatch);
const styleIndex = html.indexOf('css/styles.css');
const scriptIndex = html.indexOf('<script>');
check('内联脚本排在样式表之前（否则仍会闪一下）',
  scriptIndex > -1 && styleIndex > -1 && scriptIndex < styleIndex,
  `script@${scriptIndex} < style@${styleIndex}`);

const inlineCode = inlineMatch ? inlineMatch[1] : '';

// 2) 时间规则一致性：把内联脚本中的 (h >= 8 && h < 18) 提取出来做对照
const inlineRule = /\(h\s*>=\s*(\d+)\s*&&\s*h\s*<\s*(\d+)\)/.exec(inlineCode);
check('内联脚本含时间区间判定', !!inlineRule,
  inlineRule ? `区间 [${inlineRule[1]}, ${inlineRule[2]})` : '未找到');

const jsRule = /h\s*>=\s*(\d+)\s*&&\s*h\s*<\s*(\d+)/.exec(themeJs);
check('theme.js 含时间区间判定', !!jsRule,
  jsRule ? `区间 [${jsRule[1]}, ${jsRule[2]})` : '未找到');

if (inlineRule && jsRule) {
  check('两处时间区间完全一致',
    inlineRule[1] === jsRule[1] && inlineRule[2] === jsRule[2],
    `内联 [${inlineRule[1]},${inlineRule[2]}) vs theme.js [${jsRule[1]},${jsRule[2]})`);
}

// 3) 真实执行内联脚本：给定不同时间与偏好，看它写到 data-theme 的值
function runInline(hour, saved, search) {
  const root = {
    attrs: {},
    style: {},
    setAttribute(k, v) { this.attrs[k] = v; }
  };
  const meta = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const sandbox = {
    document: {
      documentElement: root,
      querySelector: () => meta
    },
    location: { search: search || '' },
    Date: class extends Date {
      constructor() { super(2026, 0, 15, hour, 0, 0); }
      static now() { return new Date(2026, 0, 15, hour).getTime(); }
    },
    localStorage: {
      getItem: () => (saved ? JSON.stringify({ theme: saved }) : null)
    },
    JSON, RegExp, String, Number
  };
  vm.runInNewContext(inlineCode, sandbox, { filename: 'inline-theme' });
  return { theme: root.attrs['data-theme'], colorScheme: root.style.colorScheme, meta: meta.attrs.content };
}

const cases = [
  // [小时, 已保存偏好, URL 覆盖, 期望主题]
  [9, null, null, 'light'],
  [21, null, null, 'dark'],
  [8, null, null, 'light'],
  [7, null, null, 'dark'],
  [17, null, null, 'light'],
  [18, null, null, 'dark'],
  [21, 'light', null, 'light'],   // 手动偏好优先于时间
  [9, 'dark', null, 'dark'],
  [21, null, '?theme=light', 'light'],  // URL 覆盖优先于一切
  [9, 'dark', '?theme=dark', 'dark'],
  [9, 'light', '?theme=auto', 'light']  // auto 时回落到时间
];

const wrong = [];
cases.forEach(([h, saved, search, want]) => {
  const got = runInline(h, saved, search);
  if (got.theme !== want) wrong.push(`${h}点 saved=${saved} url=${search} → ${got.theme}（期望 ${want}）`);
  if (got.colorScheme !== want) wrong.push(`${h}点 colorScheme=${got.colorScheme}（期望 ${want}）`);
});
check('内联脚本各种时间/偏好组合判定正确', wrong.length === 0,
  wrong.length ? '\n     ' + wrong.join('\n     ') : `${cases.length} 组用例`);

// 4) 地址栏配色 meta 同步
const metaOk = cases.every(([h, saved, search, want]) => runInline(h, saved, search).meta === (want === 'light' ? '#f2f4f9' : '#0b0f1a'));
check('theme-color 随主题切换', metaOk);

console.log(`\n${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}\n`);
process.exit(failures === 0 ? 0 : 1);
