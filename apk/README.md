# ChOIceN 手机壳（Android）

一个**只用来显示 [choice.imhaoyuan.tyu.me](https://choice.imhaoyuan.tyu.me) 的原生 WebView 容器**。

它**不是浏览器**：没有地址栏、前进后退、标签页、书签、历史记录、下载、分享、页内查找、桌面模式。
站外链接在应用内直接忽略，不会跳到系统浏览器。整个 APK 只声明一个 `INTERNET` 权限。

- 包名 `me.tyu.imhaoyuan.choice` · 应用名 `ChOIceN`
- minSdk **24**（Android 7.0）/ targetSdk 35
- 产物约 **50 KB**，无 AndroidX、无第三方库、无广告 SDK、无后台服务
- 网页是**在线**加载的：改网页不需要重新打包，手机上刷新即可看到

## 目录

```
apk/
├─ AndroidManifest.xml                  清单（权限、竖屏、图标、主题）
├─ src/me/tyu/imhaoyuan/choice/
│   └─ MainActivity.java                唯一的 Java 文件，约 180 行
├─ res/
│   ├─ values/                          应用名、配色、无标题栏深色主题
│   ├─ drawable/ic_launcher_foreground.xml   金币矢量图（取自网页 favicon 的形状）
│   ├─ mipmap-anydpi-v26/ic_launcher.xml     自适应图标（Android 8.0+）
│   └─ mipmap-*dpi/ic_launcher.png           传统图标五档（Android 7.x）
├─ tools/make-icons.py                  重新生成上面那五档 PNG（用 Pillow 画，无外部素材）
├─ make-keystore.ps1                    一次性生成自用签名钥匙
└─ build.ps1                            构建 → ../out/ChOIceN.apk
```

## 构建

不依赖 Gradle、Android Studio 图形界面，也**不联网下载任何依赖**，直接串 SDK 自带的命令行工具：

```
aapt2 compile → aapt2 link → javac → d8 → 塞入 classes.dex → zipalign → apksigner
```

```powershell
# 1) 首次：生成签名钥匙（只需一次）
pwsh -File apk\make-keystore.ps1

# 2) 构建
pwsh -File apk\build.ps1
```

产物：

| 文件 | 说明 |
| --- | --- |
| `out\ChOIceN.apk` | 可安装的签名包 |
| `out\BUILD-INFO.txt` | 包名、版本、权限、大小、SHA-256、证书指纹、工具链版本 |

### 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-SdkRoot` | `D:\AndroidStudio\SDK` | Android SDK 根目录 |
| `-BuildTools` | `36.0.0` | build-tools 版本 |
| `-Platform` | `android-37.0` | 拿哪个 `android.jar` 当引导类路径；出问题可回退 `android-28` |
| `-JdkHome` | `C:\Program Files\Zulu\zulu-21` | 提供 `javac` / `jar` |
| `-KeystoreDir` | `%USERPROFILE%\.android\choice-keystore` | 签名钥匙所在目录 |
| `-SkipSign` | — | 只构建不签名，产物在 `apk\build\aligned.apk` |

版本号、`minSdk`、`targetSdk` 全部从 `AndroidManifest.xml` 读取，只有一处需要改。

## 签名

钥匙默认放在 **仓库之外**：`%USERPROFILE%\.android\choice-keystore\`

```
choice-release.jks        自用 release 钥匙（PKCS12，RSA 2048，有效期 10000 天）
keystore.properties       含明文口令
```

> ⚠️ **这个目录必须备份。** 钥匙丢了就无法覆盖升级已安装的应用，只能卸载重装 ——
> 而 `localStorage` 里的主题偏好和骰子累计统计会一起清零。

minSdk 24 起平台就支持 v2 签名，所以只签 **v2 + v3**，不签 v1（AGP 在 minSdk ≥ 24 时同样如此）。

## 重新生成图标

```powershell
<bundled-python> apk\tools\make-icons.py
```

金币形状直接抄自 `index.html` 里的内联 SVG favicon（`#F0C34D` + 描边 `#A87C1C`），
所以没有任何外部图片素材，五档 PNG 都是画出来的。

## 行为说明

| 场景 | 行为 |
| --- | --- |
| 启动 | 全屏加载 `https://choice.imhaoyuan.tyu.me`，底色 `#0b0f1a`，不会白闪 |
| 站内导航 | 放行（含子域） |
| 站外链接 | 忽略，不跳系统浏览器 |
| 系统返回键 | ① 关掉页面里的浮层（网页自带确认弹窗 → 「更多选项」下拉）→ ② 退一个 hash 历史 → ③ 退出应用 |
| 屏幕方向 | 锁定竖屏 |
| 缩放 | 禁用（含双指缩放） |
| 系统栏让位 | 状态栏与导航栏的高度做成容器给 WebView 的外边距，页面不会顶到通知栏底下；额外留白目前为 0（`EXTRA_TOP_DP = 0`），想找回「像手机浏览器那样正文上方空一段」的观感就把它调成 56 —— 56dp 是 Android Chrome 地址栏的高度 |
| 配色跟随 | 读页面的 `<meta name="theme-color">`，把系统栏与让位区域一起刷成页面底色，深浅主题切换时跟着变（浅色 `#f2f4f9` / 深色 `#0b0f1a`），状态栏图标明暗自动适配 |
| 页面里的原生对话框 | 网页的「清空统计」已经改成 DOM 弹窗，不再依赖原生对话框；壳另外挂了 `WebChromeClient` 兜底，免得以后页面里冒出 `alert()` / `confirm()` 时被 WebView 静默吞掉 |
| 断网 | **不做任何处理**，显示 WebView 默认的错误提示 |
| 后台切换 | 会保存并恢复 WebView 状态，不重新加载 |
| 熄屏/后台 | 配色轮询在 `onPause` 停止，回到前台自动恢复 |

### 两个踩过的坑（改动前请先读）

**一、让位系统栏不要用 WebView 自己的 padding。** 第一版是在 WebView 上调 `setPadding`，
结果手机上页面照样铺到通知栏底下 —— WebView（Chromium 内核）按视图的完整尺寸计算页面视口，
未必尊重自身 padding。现在改成 `FrameLayout` 容器 + **外边距**，这是确定的。

**二、insets 不要只信回调里给的值。** `onApplyWindowInsets` 回调里可能拿到被上层消费过的 0，
所以真正计算时是读 `getRootWindowInsets()`（不受消费影响），并且以
`android:dimen/status_bar_height` 兜底 —— 宁可多让一点，也不能让内容顶到通知栏底下。
insets 的首次分发时机也不保证早于第一次计算，所以它和配色轮询共用同一个节拍，
每拍重算一次（值没变时 `setLayoutParams` 不会触发重新布局）。

**三、要自己声明边到边，不能靠系统替你决定。** `getRootWindowInsets()` 给的是系统原始
insets，而 Android 14 及更早的系统本来就会自动替应用让出系统栏 —— 不显式声明
`setDecorFitsSystemWindows(false)` 的话，那些机器上就会**重复让位**成两倍。
顶部只算状态栏，底部还要和「系统强制手势区」取较大值，免得按钮压在手势条下面。

返回键的处理值得一提：它注入一段 JS，复用**页面自己已经有的**「按 Esc 关闭浮层」逻辑
（下拉见 `js/app.js`，确认弹窗按标准无障碍角色 `[role="dialog"]` 找），因此**不需要为返回键改动网页代码**。

配色跟随也是同样思路：页面把当前主题写在 `<meta name="theme-color">` 里，壳每隔
150ms（拿到值后放慢到 600ms，只在 `onResume` 期间）问一次，变了就把系统栏和让位区域
一起刷成同一个颜色。页面没有对外暴露主题变更事件，又不想为了这件事给网页挂一个
JS 桥（那是额外的攻击面），所以选了轮询这条更笨但更省事的路。

## 改网址

改 `MainActivity.java` 顶部的两个常量即可：

```java
private static final String HOME_URL  = "https://choice.imhaoyuan.tyu.me";
private static final String HOME_HOST = "choice.imhaoyuan.tyu.me";
```

## 安装到手机

```powershell
adb install -r out\ChOIceN.apk
```

或者把 `out\ChOIceN.apk` 传到手机点击安装（首次需要允许「安装未知应用」）。
包名与签名不变的情况下，`-r` 可以覆盖升级，数据保留。
