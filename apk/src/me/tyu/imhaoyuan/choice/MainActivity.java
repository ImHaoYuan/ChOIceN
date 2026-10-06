package me.tyu.imhaoyuan.choice;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ChOIceN 的手机壳。
 *
 * <p>全屏一个 WebView，只加载本站，不提供任何浏览器功能：没有地址栏、前进后退、
 * 标签页、书签、历史、下载、分享、页内查找、桌面模式。站外链接在应用内直接忽略。
 *
 * <p>与页面通信只有两处，都是运行期注入，不改网页代码：
 * <ol>
 *   <li>返回键 —— 复用页面自己已有的「Esc 关闭浮层」逻辑（更多选项下拉、网页自带弹窗）；</li>
 *   <li>配色跟随 —— 读页面声明的 {@code <meta name="theme-color">}，把系统栏与让位留白
 *       刷成同一个颜色，深浅主题切换时跟着变。</li>
 * </ol>
 *
 * <p>页面让位系统栏用的是**容器外边距**，不是 WebView 自己的 padding：
 * WebView（Chromium 内核）按视图完整尺寸计算页面视口，未必尊重自身 padding，
 * 之前用 padding 的结果就是页面照样铺到通知栏底下。
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://choice.imhaoyuan.tyu.me";
    private static final String HOME_HOST = "choice.imhaoyuan.tyu.me";

    /** 页面底色 #0b0f1a，与 index.html 的 theme-color 一致，避免加载瞬间白闪。 */
    private static final int COLOR_BG = 0xFF0B0F1A;

    /**
     * 状态栏之下额外再留的空白，单位 dp。目前是 0（只让出系统栏，不留白）。
     * 想找回「像手机浏览器那样正文上方空一段」的观感，把它调成 56 左右即可 ——
     * 56dp 是 Android Chrome 地址栏的高度，浏览器里正文上方正是这一段。
     * 调大之后记得同时确认留白颜色跟着主题走（见 applyChromeColor）。
     */
    private static final int EXTRA_TOP_DP = 0;

    /**
     * 追问页面配色的间隔。页面没有对外事件，只能轮询；拿到值之前问得密一点，
     * 免得浅色主题下顶部先黑一下，拿到之后放慢。
     */
    private static final long POLL_FAST_MS = 150L;
    private static final long POLL_SLOW_MS = 600L;

    /**
     * 返回键问页面：有没有浮层开着？有就派发 Escape 关掉，应答 "closed"，否则 "none"。
     *
     * <p>先找 {@code [role="dialog"]}（网页自带的确认弹窗，标准无障碍角色），
     * 再找「更多选项」下拉。关不掉就如实回答，让返回键继续走"退一页 / 退出"。
     */
    private static final String JS_HANDLE_BACK =
            "(function(){try{"
                    + "var d=document.querySelector('[role=\"dialog\"]');"
                    + "if(d){"
                    + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));"
                    + "if(!document.querySelector('[role=\"dialog\"]')){return 'closed';}"
                    + "}"
                    + "var p=document.getElementById('morePanel');"
                    + "if(p&&!p.hidden){"
                    + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));"
                    + "if(!p.hidden&&document.body){document.body.click();}"
                    + "return 'closed';"
                    + "}"
                    + "return 'none';"
                    + "}catch(e){return 'none';}})()";

    /**
     * 读网页声明的 theme-color。页面在 {@code <head>} 的内联防闪脚本里就把它写好了
     * （浅色 #f2f4f9 / 深色 #0b0f1a），之后主题一变会同步更新，所以这是最准的信号；
     * 万一没有这个 meta，就退回页面自己的背景色。
     */
    private static final String JS_CHROME_COLOR =
            "(function(){try{"
                    + "var m=document.querySelector('meta[name=\"theme-color\"]');"
                    + "var v=m&&m.getAttribute('content');"
                    + "if(!v){var el=document.body||document.documentElement;"
                    + "v=el?getComputedStyle(el).backgroundColor:'';}"
                    + "return v||'';"
                    + "}catch(e){return '';}})()";

    /** 从 evaluateJavascript 拿到的 CSS 颜色：'#rrggbb' / 'rgb(r,g,b)' / 'rgba(r,g,b,a)'。 */
    private static final Pattern CSS_RGB = Pattern.compile(
            "rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)");

    /** 页面回话的超时兜底：万一 JS 没应答，不能让返回键卡死。 */
    private static final long BACK_TIMEOUT_MS = 400L;

    private FrameLayout root;
    private WebView web;

    /** 正在等页面回话，期间忽略连按。 */
    private boolean backPending;

    /** 当前给系统栏与让位区域用的颜色；是否已经从页面拿到过值。 */
    private int chromeColor = COLOR_BG;
    private boolean chromeColorReady;

    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable insetApplier = new Runnable() {
        @Override
        public void run() {
            applyWindowInsets();
        }
    };

    private final Runnable colorPoller = new Runnable() {
        @Override
        public void run() {
            // insets 的首次分发不保证早于我们的第一次计算，颜色也一样要等页面，
            // 所以两件事共用一个节拍：每拍都重算一次，值没变时 setLayoutParams
            // 不会引起重新布局，白算也不亏。
            applyWindowInsets();
            pollChromeColor();
            handler.postDelayed(this, chromeColorReady ? POLL_SLOW_MS : POLL_FAST_MS);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        goEdgeToEdge();

        web = new WebView(this);
        web.setBackgroundColor(COLOR_BG);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 主题偏好、骰子累计统计要存 localStorage
        s.setSupportZoom(false);               // 不做缩放，保持网页本来样子
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // 网页里的确认弹窗已经改成 DOM 弹窗（不再依赖原生对话框），这里挂一个
        // WebChromeClient 纯属兜底：万一以后页面里又冒出 alert/confirm，
        // 没有它的话 WebView 会静默返回 false，按钮就成了"点了没反应"。
        web.setWebChromeClient(new WebChromeClient());

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 只放行本站（含子域）；站外链接在应用内忽略，不跳系统浏览器
                String host = request.getUrl() == null ? null : request.getUrl().getHost();
                boolean mine = HOME_HOST.equals(host)
                        || (host != null && host.endsWith("." + HOME_HOST));
                return !mine;
            }
        });

        // WebView 装进容器：让位系统栏靠容器的外边距，而不是 WebView 自己的 padding
        root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                // 回调里拿到的可能是被上层消费过的 0，真正算的时候重新读根视图的 insets
                v.post(insetApplier);
                return insets;
            }
        });
        root.post(insetApplier);

        boolean restored = state != null && web.restoreState(state) != null;
        if (!restored) {
            web.loadUrl(HOME_URL);
        }
    }

    /* ------------------------------------------------------------------
       让位系统栏
       ------------------------------------------------------------------ */

    /**
     * 明确声明「边到边」，即内容铺满整屏、系统栏让位由我们自己负责。
     *
     * <p>Android 15+ 对 targetSdk 35 是强制边到边，不写也一样；但 Android 14 及更早
     * 的系统本来就会替应用让出系统栏，而 {@link View#getRootWindowInsets()} 读到的是
     * 系统原始 insets（不受消费影响），不声明就会**重复让位**成两倍。
     * 自己拿过来管，各版本行为才一致。
     */
    @SuppressWarnings("deprecation")
    private void goEdgeToEdge() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /** 把状态栏、导航栏的高度做成容器给 WebView 的外边距（顶部另加 EXTRA_TOP_DP）。 */
    private void applyWindowInsets() {
        if (web == null) {
            return;
        }
        int[] bars = systemBars();
        int top = bars[0] + Math.round(
                getResources().getDisplayMetrics().density * EXTRA_TOP_DP);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
        if (lp == null) {
            return;
        }
        if (lp.topMargin != top || lp.bottomMargin != bars[1]) {
            lp.topMargin = top;
            lp.bottomMargin = bars[1];
            web.setLayoutParams(lp);
        }
    }

    /**
     * 系统栏高度。优先读根视图的 insets —— 它不受上层消费影响，比在回调里拿到的可靠；
     * 首次测量时系统可能还没下发，这时用 {@code android:dimen/status_bar_height} 兜底。
     * 两者取较大值：系统资源那个值有时不含挖孔区带来的额外高度
     * （本机真实状态栏 inset 是 121px），宁可多让一点，也不能让页面顶到通知栏底下。
     */
    @SuppressWarnings("deprecation")
    private int[] systemBars() {
        int top = 0;
        int bottom = 0;
        WindowInsets insets = root == null ? null : root.getRootWindowInsets();
        if (insets != null) {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                // 底部把「系统强制手势区」也算进去：手势导航时那一条不属于应用的可用区域，
                // 按钮压在下面会被上滑手势抢走。两者取大，手势导航和三大金刚键都成立。
                bottom = Math.max(bars.bottom,
                        insets.getInsets(WindowInsets.Type.mandatorySystemGestures()).bottom);
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
        }
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (id > 0) {
            top = Math.max(top, getResources().getDimensionPixelSize(id));
        }
        return new int[] { top, bottom };
    }

    /* ------------------------------------------------------------------
       配色跟随：系统栏与让位区域刷成页面底色
       ------------------------------------------------------------------ */

    @Override
    protected void onResume() {
        super.onResume();
        handler.removeCallbacks(colorPoller);
        handler.post(colorPoller);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(colorPoller);   // 退到后台就别再问了
    }

    /** 问页面当前配色；变了就把原生那一圈一起换掉。 */
    private void pollChromeColor() {
        if (web == null) {
            return;
        }
        try {
            web.evaluateJavascript(JS_CHROME_COLOR, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    Integer color = parseCssColor(value);
                    if (color == null) {
                        return;
                    }
                    chromeColorReady = true;
                    if (color != chromeColor) {
                        chromeColor = color;
                        applyChromeColor(color);
                    }
                }
            });
        } catch (Throwable ignored) {
            // 页面还没准备好，下次再问
        }
    }

    /**
     * 系统栏与让位留白都刷成页面底色。
     *
     * <p>Android 15 起（targetSdk 35 强制边到边）状态栏是透明的，真正决定它长什么样的
     * 是内容自己画了什么 —— 也就是容器和 WebView 的背景色；老系统上则靠 setStatusBarColor。
     * 两处都设，两代系统都对。图标明暗跟着底色走，否则浅色底上的白图标会看不见。
     */
    @SuppressWarnings("deprecation")
    private void applyChromeColor(int color) {
        if (root != null) {
            root.setBackgroundColor(color);     // 让位留白处看到的就是这个颜色
        }
        if (web != null) {
            web.setBackgroundColor(color);
        }
        Window window = getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);

        boolean light = isLightColor(color);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags = light
                    ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) {
                flags = light
                        ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                        : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** 解析 evaluateJavascript 回传的颜色字符串（带 JSON 引号）。解析不了返回 null。 */
    private static Integer parseCssColor(String js) {
        if (js == null) {
            return null;
        }
        String s = js.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1).trim();
        }
        if (s.isEmpty() || "null".equals(s)) {
            return null;
        }
        try {
            if (s.charAt(0) == '#') {
                return Color.parseColor(s);
            }
            Matcher m = CSS_RGB.matcher(s);
            if (m.matches()) {
                int alpha = m.group(4) == null
                        ? 255
                        : Math.round(Float.parseFloat(m.group(4)) * 255f);
                if (alpha == 0) {
                    return null;                 // 全透明等于没拿到颜色
                }
                return Color.argb(alpha,
                        Integer.parseInt(m.group(1)),
                        Integer.parseInt(m.group(2)),
                        Integer.parseInt(m.group(3)));
            }
        } catch (Throwable ignored) {
            // 解析不了就当没拿到
        }
        return null;
    }

    /** 底色是否偏亮 —— 决定状态栏图标用深色还是浅色。 */
    private static boolean isLightColor(int color) {
        double luma = (0.299 * Color.red(color)
                + 0.587 * Color.green(color)
                + 0.114 * Color.blue(color)) / 255.0;
        return luma > 0.6;
    }

    /* ------------------------------------------------------------------
       返回键
       ------------------------------------------------------------------ */

    /**
     * 返回键三级处理：先让页面关掉浮层（确认弹窗 / 更多选项下拉），
     * 其次退一个 hash 历史，最后才退出应用。
     */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        if (backPending) {
            return;
        }
        backPending = true;

        final Runnable timeout = new Runnable() {
            @Override
            public void run() {
                if (!backPending) {
                    return;
                }
                backPending = false;
                resolveBack("none");
            }
        };

        web.postDelayed(timeout, BACK_TIMEOUT_MS);
        try {
            web.evaluateJavascript(JS_HANDLE_BACK, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (!backPending) {
                        return;
                    }
                    web.removeCallbacks(timeout);
                    backPending = false;
                    resolveBack(value);
                }
            });
        } catch (Throwable t) {
            web.removeCallbacks(timeout);
            backPending = false;
            resolveBack("none");
        }
    }

    /** ① 页面刚关掉浮层 → 吃掉这次返回键；② 有上一页 → 退一页；③ 否则退出应用。 */
    private void resolveBack(String jsResult) {
        if (jsResult != null && jsResult.contains("closed")) {
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(colorPoller);
        handler.removeCallbacks(insetApplier);
        if (web != null) {
            web.stopLoading();
            web.setWebViewClient(null);
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
