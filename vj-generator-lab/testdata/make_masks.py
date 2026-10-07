"""
生成轮廓跟踪算法的测试掩膜。
输出: 每个用例一个 .bin (uint8 alpha, 行优先) + 一个 index.json 描述。
刻意挑选了洞的嵌套关系已知的字，用来验证跟踪算法会不会把"洞"搞错。
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
FONTS = {
    "noto":  r"C:\Windows\Fonts\NotoSansSC-VF.ttf",
    "hei":   r"C:\Windows\Fonts\simhei.ttf",
    "yahei": r"C:\Windows\Fonts\msyh.ttc",
}

# case: (文字, 字体key, 字号, 期望的洞数, 说明)
CASES = [
    ("A",         "hei",  520, 1, "拉丁字母，1 个洞（三角孔）"),
    ("口",        "noto", 520, 1, "最简单的带洞汉字"),
    ("回",        "noto", 520, 2, "洞中洞，嵌套拓扑，最容易搞错"),
    ("王",        "noto", 520, 0, "无洞，纯外轮廓"),
    ("舞",        "hei",  520, 5, "复杂汉字，多笔画多洞"),
    ("魔",        "noto", 520, 4, "复杂汉字，笔画密集"),
    ("ASIAN",     "hei",  380, 3, "多字母组合，洞数=A(1)+A(1)+? "),
    ("SAKEE",     "noto", 380, 0, "多字母，无洞"),
]

CANVAS_W, CANVAS_H = 2048, 1024


def render(text, font_key, size):
    font = ImageFont.truetype(FONTS[font_key], size)
    img = Image.new("L", (CANVAS_W, CANVAS_H), 0)
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    # 居中，留出边距
    x = (CANVAS_W - tw) // 2 - box[0]
    y = (CANVAS_H - th) // 2 - box[1]
    d.text((x, y), text, fill=255, font=font)
    return img, (tw, th)


def main():
    index = []
    for i, (text, fk, size, holes, note) in enumerate(CASES):
        img, (tw, th) = render(text, fk, size)
        name = f"case{i:02d}"
        img.tobytes()  # noqa
        with open(os.path.join(OUT, name + ".bin"), "wb") as f:
            f.write(img.tobytes())
        index.append({
            "name": name, "text": text, "font": fk, "size": size,
            "expectHoles": holes, "note": note,
            "width": CANVAS_W, "height": CANVAS_H,
            "textW": tw, "textH": th,
        })
        # 顺带存一张缩略图，方便人工核对
        img.resize((512, 256)).save(os.path.join(OUT, name + "_thumb.png"))
        print(f"{name}: {text!r} font={fk} textBox={tw}x{th} expectHoles={holes}")

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print("wrote", len(index), "cases to", OUT)


if __name__ == "__main__":
    main()
