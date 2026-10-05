# ChOIceN · 让随机帮你做决定

一个纯 **HTML + CSS + JavaScript** 的抛硬币小站（无框架、无构建、无依赖），
随机结果来自**当前时间**，界面按「多功能」结构设计，方便后续继续加功能。

```
直接双击 index.html 即可打开（无需服务器、无需联网）
```

---

## 1. 已实现

| 能力 | 说明 |
| --- | --- |
| 抛硬币 | 3D 感翻转动画、抛起与落地阴影、落定高光 |
| 时间随机 | 毫秒时间戳 + 高精度计时 + 调用间隔 + 调用序号 → 64 位状态池 |
| 同毫秒不重复 | 同一毫秒内连续抛掷也能得到不同结果 |
| 统计与历史 | 累计次数、正反次数与占比、最近结果条 |
| 随机源可视化 | 面板实时展示本次随机的位、状态池、时间间隔等 |
| 深色 / 浅色主题 | 默认按本地时间自动切换（8:00–18:00 浅色），也可手动固定 |
| 音效 | 用 WebAudio 实时合成，不依赖音频文件，可开关 |
| 偏好持久化 | 统计 / 历史 / 设置 / 主题模式写入 localStorage |
| 快捷键 | `空格` 抛一次，`Alt+1..4` 切换功能 |

## 2. 目录结构

```
ChOIceN/
├── index.html              页面骨架 + 顶部栏 + 首屏防闪主题脚本
├── css/
│   └── styles.css          设计令牌（深浅两套）、组件样式、硬币动画、响应式
├── js/
│   ├── rng.js              时间随机源（FNV-1a 混合 + xorshift64* + 雪崩）
│   ├── store.js            localStorage 封装（统计 / 历史 / 设置）
│   ├── audio.js            WebAudio 实时合成音效
│   ├── theme.js            主题：按时间判定 + 手动切换 + 持久化
│   ├── ui.js               DOM 构造、格式化、提示条等小工具
│   ├── coin.js             硬币元件（翻转动画 + 币面切换 + 运动模糊）
│   ├── modes.js            功能注册表 + 抛硬币视图 + 未来功能占位
│   └── app.js              启动、hash 路由、侧边导航、全局设置、主题按钮
├── smoke-test.mjs          无浏览器冒烟测试（见第 5 节）
├── check-inline-theme.mjs  校验首屏防闪脚本与 theme.js 规则一致（见第 6 节）
└── README.md
```

## 3. 随机是怎么来的

`js/rng.js` 每次取值都会：

1. 采集时间熵：`Date.now()`、`performance.now()` 的整数与小数部分、与上次调用的间隔、调用序号；
2. 若浏览器提供 `crypto.getRandomValues`，再混入 1 字节系统随机数（不可用时自动退化为纯时间熵）；
3. 用 FNV-1a 变体把这些位混进 64 位状态池，跑一轮 xorshift64\*，再做一次雪崩；
4. 归一化到 `[0, 1)`，或取最低位决定正/反面。

> 注意：`side()` 会**自己消耗一次随机数**。不要改成读取上一次留下的位，
> 否则会读到陈旧值，导致结果恒定（开发过程中真的踩过这个坑）。

另一个坑：末尾雪崩不能写成 `bits ^= bits >>> 31`——那会把最低位恒置为 0，
而正反面恰好读最低位，结果就会永远是正面。

## 4. 硬币为什么不用 3D 变换

经典写法是 `rotateX` + `preserve-3d` + `backface-visibility: hidden`。
实测这条路依赖渲染器实现细节，**会渲染出「镜像的正面字」**：

- DOM 上只要有 `filter`（哪怕只是 `filter: blur(0)`），3D 上下文就被扁平化，`backface-visibility` 失效；
- 部分渲染器（软件渲染 / 关闭 GPU 合成）直接忽略 `backface-visibility`；
- 3D 上下文里子元素的绘制顺序由深度排序决定，不保证按 DOM 顺序。

所以改为**纯 2D 透视模拟**，结果是确定性的：

- 用 `scaleY(|cos θ|)` 模拟转轴压扁，最小 0.04 给出「侧面对着你」的瞬间；
- 上下两个错位图层露出的一线底色即为硬币厚度；
- 由 JS 按角度显式切换币面（`0°–90° / 270°–360°` 正面，`90°–270°` 反面），隐藏用 `display: none`，绝无重叠；
- 运动模糊放在独立图层，按角速度调模糊量与透明度——`filter` 只加在这一层上。

## 5. 深浅主题

三种模式，点顶部栏（或设置面板）的主题按钮循环切换：**跟随时间 → 浅色 → 深色 → 跟随时间**。

| 模式 | 行为 |
| --- | --- |
| 跟随时间（默认） | 本地时间 **08:00–17:59 用浅色**，其余用深色；运行期间跨过 8 点 / 18 点会自动切换（每 60 秒检查一次） |
| 浅色 | 始终浅色 |
| 深色 | 始终深色 |

实现要点：

1. **首屏防闪**：`index.html` 的 `<head>` 里有一段内联脚本，在样式表之前就把
   `data-theme` 写到 `<html>` 上。否则会先渲染深色、脚本跑起来再跳成浅色。
   这段脚本不能引用外部文件，所以它的规则与 `js/theme.js` 的 `themeByTime()` 必须同步——
   用 `check-inline-theme.mjs` 自动校验（见第 6 节）。
2. **两套令牌**：颜色全部走 CSS 变量，深色定义在 `:root, [data-theme="dark"]`，
   浅色整体覆盖在 `[data-theme="light"]`。组件样式里**不允许写死颜色**，
   否则浅色模式一定会漏改。新增颜色时请同时在两个块里加令牌。
3. **主题按钮**：`ctx.themeControl()` 可以让任何功能视图拿到同款按钮（抛硬币的设置面板就是这么用的），
   样式与状态（`data-mode` / `data-changed` 动画）由 `app.js` 统一维护。
4. 模式存在 `choicen.v1.settings.theme`，与其它偏好一致。

## 6. 自动化测试

`smoke-test.mjs` 用最小 DOM 桩在 Node 里加载全部前端脚本，覆盖 45+ 项断言：
挂载、随机分布的均值与正反比例、同毫秒不重复、按角度切换币面、
落定角度与结果一致、统计与历史写入、占位功能渲染、
**主题的时间判定（含 7:59 / 8:00 / 17:59 / 18:00 边界）、三种模式、循环切换、持久化与回调**、
存储与重置。

`check-inline-theme.mjs` 单独校验 `index.html` 的首屏脚本：
它真实执行那段内联代码，用 11 组「时间 × 已保存偏好 × URL 覆盖」组合比对结果，
并确认它与 `js/theme.js` 的时间区间完全一致。

```powershell
node smoke-test.mjs
node check-inline-theme.mjs
```

`stats` / `history` / `settings` 的键名统一带 `choicen.v1.` 前缀，未来升级可平滑迁移。

## 7. 怎么加下一个功能

1. 在 `js/modes.js` 的 `App.modes.list` 里加一条：

```js
{
  id: 'dice', icon: '🎲', name: '掷骰子', desc: '1–6 点随机',
  available: true,                       // 改 true 后侧边卡片即可点击
  mount: function (root, ctx) {          // 在 root 里渲染自己的界面
    // ctx.go('coin') 切换功能；ctx.toast('...') 弹提示；ctx.isActive() 判断当前是否可见
    // ctx.themeControl() 拿一个主题切换按钮；ctx.resetStats() 清空统计
    // App.rng.int(6) + 1 取随机点数；App.store.record(...) 记统计
  }
}
```

2. 侧边导航、hash 路由（`#/dice`）、卡片高亮、快捷键都会自动生效；
3. 只需为自己的界面补样式，通用组件（`.panel` / `.btn` / `.metric` / `.switch` / `.chip`）可直接复用；
   颜色请引用 CSS 变量，这样两种主题都不用额外适配。

已预留的占位功能：掷骰子、随机数字、转盘抽签。

## 8. 调试小开关

- `index.html#/coin` —— 默认视图（主题按时间自动决定）；
- `index.html?theme=light#/coin` —— 强制浅色；`?theme=dark` 强制深色；`?theme=auto` 回到按时间。
  这个覆盖只作用于当前这次打开，不会改写你保存的偏好；
- `index.html?demo=1#/coin` —— 打开后自动抛一次，方便看结果态（可与 `?theme=` 叠加）；
- `window.__coin` —— 控制台可直接访问硬币对象（`renderAngle(120)`、`visibleFace()`、`currentAngle()`）；
- `App.theme` —— 控制台可直接调用 `App.theme.setMode('light')` / `App.theme.themeByTime(new Date())`。
