#!/usr/bin/env python3
"""生成传统启动图标 PNG（Android 8.0 以下用得到）。

自适应图标（API 26+）走 res/drawable/ic_launcher_foreground.xml，
这个脚本只负责 res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png 五档。

硬币形状来自 index.html 里的 favicon（内联 SVG），颜色 #F0C34D + 描边 #A87C1C，
所以这里没有引入任何外部图片素材 —— 图是算出来的。
用 8 倍超采样再缩回来，得到干净的抗锯齿边缘。

用法：
    <bundled-python> apk/tools/make-icons.py
只在需要重新生成图标时跑一次，产物已随仓库提交。
"""

from pathlib import Path

from PIL import Image, ImageDraw

FILL = (240, 195, 77, 255)     # #F0C34D
STROKE = (168, 124, 28, 255)   # #A87C1C
SUPERSAMPLE = 8

DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

RES_DIR = Path(__file__).resolve().parent.parent / "res"


def render(size: int) -> Image.Image:
    """画一枚金币，返回 size×size 的 RGBA 图。"""
    n = size * SUPERSAMPLE
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = n * 0.055
    stroke = max(SUPERSAMPLE, round(n * 0.055))
    box = (margin, margin, n - margin - 1, n - margin - 1)

    draw.ellipse(box, fill=FILL, outline=STROKE, width=stroke)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for density, size in DENSITIES.items():
        out_dir = RES_DIR / f"mipmap-{density}"
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "ic_launcher.png"
        render(size).save(path, "PNG", optimize=True)
        print(f"{path.relative_to(RES_DIR.parent)}  {size}x{size}  {path.stat().st_size} B")


if __name__ == "__main__":
    main()
