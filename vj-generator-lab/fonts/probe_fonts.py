"""
探测 Google Fonts 的 GitHub 仓库里有哪些可用的街头/hiphop 风格字体。
不做猜测：逐个查目录、拿真实文件名和体积，再决定下载哪些。
Google Fonts 全部为 OFL 或 Apache 协议，免费商用、可再分发。
"""
import json
import urllib.request
import urllib.error

UA = {"User-Agent": "Mozilla/5.0 (font-probe)"}
API = "https://api.github.com/repos/google/fonts/contents/{path}"

# (目录名, 中文说明)
CANDIDATES = [
    # 拉丁 / 街头 / 涂鸦向
    ("bungee",            "Bungee 城市招牌"),
    ("bungeeshade",       "Bungee Shade 层叠阴影"),
    ("bungeeinline",      "Bungee Inline 内嵌线"),
    ("bungeespice",       "Bungee Spice 彩色渐变"),
    ("permanentmarker",   "Permanent Marker 马克笔涂鸦"),
    ("anton",             "Anton 重磅窄体"),
    ("archivoblack",      "Archivo Black 重磅"),
    ("rubikbeastly",      "Rubik Beastly 锯齿扭曲"),
    ("rubikburned",       "Rubik Burned 烧灼"),
    ("rubikglitch",       "Rubik Glitch 故障"),
    ("rubikpuddles",      "Rubik Puddles 液态"),
    ("rubikiso",          "Rubik Iso 等高线"),
    ("rubikmoonrocks",    "Rubik Moonrocks 陨石"),
    ("tiltneon",          "Tilt Neon 霓虹管"),
    ("tiltprism",         "Tilt Prism 棱镜"),
    ("tiltwarp",          "Tilt Warp 扭曲"),
    ("monoton",           "Monoton 复古平行线"),
    ("nabla",             "Nabla 立体彩色"),
    ("bangers",           "Bangers 漫画冲击"),
    ("fasterone",         "Faster One 速度线"),
    ("blackopsone",       "Black Ops One 军事模板"),
    ("russoone",          "Russo One 科技"),
    ("metalmania",        "Metal Mania 金属乐队"),
    ("bungeeoutline",     "Bungee Outline 空心"),
    # 中文 / 街头向（OFL）
    ("zcoolqingkehuangyou", "站酷庆科黄油体"),
    ("zcoolkuaile",         "站酷快乐体"),
    ("zcoolxiaowei",        "站酷小薇体"),
    ("mashanzheng",         "马善政毛笔楷书"),
    ("zhimangxing",         "志莽行书"),
    ("longcang",            "龙藏体"),
]

def list_dir(path):
    try:
        req = urllib.request.Request(API.format(path=path), headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None if e.code == 404 else f"HTTP {e.code}"
    except Exception as e:
        return f"ERR {type(e).__name__}"

def main():
    found = []
    for name, note in CANDIDATES:
        entry = None
        for bucket in ("ofl", "apache", "ufl"):
            items = list_dir(f"{bucket}/{name}")
            if isinstance(items, list):
                entry = (bucket, items)
                break
            if isinstance(items, str) and not items.startswith("HTTP 404"):
                print(f"  ! {name}: {items}")
        if not entry:
            print(f"✗ {name:22} 目录不存在")
            continue
        bucket, items = entry
        fonts = [i for i in items if i["name"].lower().endswith((".ttf", ".otf"))]
        if not fonts:
            print(f"✗ {name:22} 目录里没有 ttf/otf")
            continue
        total = sum(f.get("size", 0) for f in fonts)
        lic = [i["name"] for i in items if "LICENSE" in i["name"].upper() or i["name"].upper().startswith("OFL")]
        print(f"✓ {name:22} [{bucket}] {len(fonts)} 个文件 {total/1024/1024:5.2f} MB  {note}")
        for f in sorted(fonts, key=lambda z: z.get("size", 0), reverse=True)[:4]:
            print(f"      {f['name']:38} {f.get('size',0)/1024:8.1f} KB")
            print(f"        {f['download_url']}")
        found.append({"name": name, "bucket": bucket, "note": note,
                      "files": [{"name": f["name"], "size": f.get("size", 0),
                                 "url": f["download_url"]} for f in fonts],
                      "license": lic})
    with open("font-candidates.json", "w", encoding="utf-8") as fh:
        json.dump(found, fh, ensure_ascii=False, indent=2)
    print(f"\n可用字体目录 {len(found)} 个，已写入 font-candidates.json")

if __name__ == "__main__":
    main()
