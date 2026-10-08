"""
下载选定的街头/hiphop 风格字体（全部 OFL / Apache，免费商用可再分发），
并生成给前端用的清单 fonts.json。

文件名扁平放在内容目录里 —— 预览服务的 /files/ 路由只取 basename，
不支持子目录。
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = r"C:\Users\Colorful\Documents\deepseek-harness\default-workspace\.superpowers\brainstorm\vj-generator\content"

UA = {"User-Agent": "Mozilla/5.0 (font-fetch)"}
RAW = "https://raw.githubusercontent.com/google/fonts/main/{bucket}/{dir}/{file}"

# (目录, 桶, 文件名, 前端显示名, 家族名, 是否中文字体, 说明)
PICKS = [
    ("bungee",          "ofl",    "Bungee-Regular.ttf",          "Bungee 城市招牌",   "VJ Bungee",       0, "纽约街头招牌体，厚重方正，最百搭的街头味"),
    ("bungeeshade",     "ofl",    "BungeeShade-Regular.ttf",     "Bungee 层叠阴影",   "VJ BungeeShade",  0, "自带右下阴影层，平移到 3D 上会很有层次"),
    ("bungeeinline",    "ofl",    "BungeeInline-Regular.ttf",    "Bungee 内嵌线",     "VJ BungeeInline", 0, "笔画中间是镂空线，挤出的边缘会很锐"),
    ("bungeeoutline",   "ofl",    "BungeeOutline-Regular.ttf",   "Bungee 空心",       "VJ BungeeOutline",0, "空心字，适合叠在背景上"),
    ("permanentmarker", "apache", "PermanentMarker-Regular.ttf", "马克笔涂鸦",        "VJ Marker",       0, "手写马克笔，最像街头喷漆签名"),
    ("anton",           "ofl",    "Anton-Regular.ttf",           "Anton 重磅窄体",    "VJ Anton",        0, "极窄极重，字距紧，力量感强"),
    ("archivoblack",    "ofl",    "ArchivoBlack-Regular.ttf",    "Archivo 重磅",      "VJ ArchivoBlack", 0, "经典无衬线超粗，干净有力"),
    ("rubikbeastly",    "ofl",    "RubikBeastly-Regular.ttf",    "Rubik 锯齿",        "VJ RubikBeastly", 0, "边缘全是锯齿，攻击性最强的拉丁款"),
    ("rubikburned",     "ofl",    "RubikBurned-Regular.ttf",     "Rubik 烧灼",        "VJ RubikBurned",  0, "边缘像被烧穿，配熔岩材质很搭"),
    ("rubikglitch",     "ofl",    "RubikGlitch-Regular.ttf",     "Rubik 故障",        "VJ RubikGlitch",  0, "电子故障感，切碎重影"),
    ("rubikpuddles",    "ofl",    "RubikPuddles-Regular.ttf",    "Rubik 液态",        "VJ RubikPuddles", 0, "笔画像融化摊开，hiphop 珠宝那味"),
    ("rubikiso",        "ofl",    "RubikIso-Regular.ttf",        "Rubik 等高线",      "VJ RubikIso",     0, "笔画里有等高线纹，像地形图"),
    ("tiltneon",        "ofl",    "TiltNeon[XROT,YROT].ttf",     "Tilt 霓虹管",       "VJ TiltNeon",     0, "可变字体，笔画就是霓虹灯管"),
    ("tiltwarp",        "ofl",    "TiltWarp[XROT,YROT].ttf",     "Tilt 扭曲",         "VJ TiltWarp",     0, "可变字体，笔画自带扭曲张力"),
    ("monoton",         "ofl",    "Monoton-Regular.ttf",         "Monoton 复古线",    "VJ Monoton",      0, "平行线构成的复古未来感"),
    ("bangers",         "ofl",    "Bangers-Regular.ttf",         "Bangers 漫画",      "VJ Bangers",      0, "美漫拟声词那种冲击感"),
    ("fasterone",       "ofl",    "FasterOne-Regular.ttf",       "Faster 速度线",     "VJ FasterOne",    0, "笔画带速度尾迹"),
    ("blackopsone",     "ofl",    "BlackOpsOne-Regular.ttf",     "军事模板",          "VJ BlackOps",     0, "军用喷漆模板字，硬朗"),
    ("russoone",        "ofl",    "RussoOne-Regular.ttf",        "Russo 科技",        "VJ RussoOne",     0, "科技感无衬线，适合电子乐"),
    ("metalmania",      "ofl",    "MetalMania-Regular.ttf",      "金属乐队",          "VJ MetalMania",   0, "重金属乐队 logo 风"),

    ("zcoolqingkehuangyou", "ofl", "ZCOOLQingKeHuangYou-Regular.ttf", "站酷庆科黄油体", "VJ ZCOOLQingKe",  1, "★中文里最街头的一款，笔画粗壮有张力"),
    ("zcoolkuaile",         "ofl", "ZCOOLKuaiLe-Regular.ttf",         "站酷快乐体",     "VJ ZCOOLKuaiLe",  1, "圆头手写，轻松活泼"),
    ("mashanzheng",         "ofl", "MaShanZheng-Regular.ttf",         "马善政毛笔楷书", "VJ MaShanZheng",  1, "毛笔楷书，配金属材质像第二张参考图"),
    ("zhimangxing",         "ofl", "ZhiMangXing-Regular.ttf",         "志莽行书",       "VJ ZhiMangXing",  1, "行书飞白，最有书法攻击性"),
]


def main():
    os.makedirs(CONTENT, exist_ok=True)
    manifest = []
    total = 0
    for d, bucket, fname, label, family, cjk, note in PICKS:
        out = os.path.join(CONTENT, fname)
        if os.path.exists(out) and os.path.getsize(out) > 1024:
            size = os.path.getsize(out)
            print(f"  已存在 {fname:36} {size/1024:8.1f} KB")
        else:
            url = RAW.format(bucket=bucket, dir=d, file=urllib.parse.quote(fname))
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                with open(out, "wb") as fh:
                    fh.write(data)
                size = len(data)
                print(f"  ✓ 下载 {fname:36} {size/1024:8.1f} KB")
            except Exception as e:
                print(f"  ✗ 失败 {fname}: {type(e).__name__} {e}")
                continue
        total += size
        manifest.append({
            "file": fname, "label": label, "family": family, "cjk": bool(cjk),
            "note": note, "sizeKB": round(size / 1024, 1),
            "license": "SIL Open Font License 1.1" if bucket == "ofl" else "Apache License 2.0",
            "source": f"https://github.com/google/fonts/tree/main/{bucket}/{d}"
        })

    with open(os.path.join(HERE, "fonts.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(CONTENT, "fonts.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print(f"\n共 {len(manifest)} 款，合计 {total/1024/1024:.1f} MB")


if __name__ == "__main__":
    import urllib.parse
    main()
