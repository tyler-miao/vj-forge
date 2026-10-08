/**
 * 下载选定的街头/hiphop 风格字体（全部 OFL / Apache，免费商用可再分发）。
 * 用 node 的 fetch —— 实测这个环境下 python 的 DNS 会间歇性失败，node 稳定。
 *
 * 文件名扁平放在内容目录里：预览服务的 /files/ 路由只取 basename，不支持子目录。
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT = String.raw`C:\Users\Colorful\Documents\deepseek-harness\default-workspace\.superpowers\brainstorm\vj-generator\content`;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// 这个环境下 raw.githubusercontent.com 时通时断，jsDelivr 稳定。
// 所以镜像列表按可用性排序，逐个试。
const MIRRORS = [
  (b, d, f) => `https://cdn.jsdelivr.net/gh/google/fonts@main/${b}/${d}/${encodeURIComponent(f)}`,
  (b, d, f) => `https://fastly.jsdelivr.net/gh/google/fonts@main/${b}/${d}/${encodeURIComponent(f)}`,
  (b, d, f) => `https://raw.githubusercontent.com/google/fonts/main/${b}/${d}/${encodeURIComponent(f)}`,
];

async function grab(bucket, dir, file) {
  const errs = [];
  for (const mk of MIRRORS) {
    const url = mk(bucket, dir, file);
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) { errs.push(`${new URL(url).host} HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) { errs.push(`${new URL(url).host} 文件过小`); continue; }
      return { buf, host: new URL(url).host };
    } catch (e) {
      errs.push(`${new URL(url).host} ${e.message}`);
    }
  }
  throw new Error(errs.join(' | '));
}

const PICKS = [
  ['bungee',          'ofl',    'Bungee-Regular.ttf',          'Bungee 城市招牌',   'VJ Bungee',        0, '纽约街头招牌体，厚重方正，最百搭的街头味'],
  ['bungeeshade',     'ofl',    'BungeeShade-Regular.ttf',     'Bungee 层叠阴影',   'VJ BungeeShade',   0, '自带右下阴影层，做成 3D 会很有层次'],
  ['bungeeinline',    'ofl',    'BungeeInline-Regular.ttf',    'Bungee 内嵌线',     'VJ BungeeInline',  0, '笔画中间是镂空线，挤出的边缘会很锐'],
  ['bungeeoutline',   'ofl',    'BungeeOutline-Regular.ttf',   'Bungee 空心',       'VJ BungeeOutline', 0, '空心字，适合叠在背景上'],
  ['permanentmarker', 'apache', 'PermanentMarker-Regular.ttf', '马克笔涂鸦',        'VJ Marker',        0, '手写马克笔，最像街头喷漆签名'],
  ['anton',           'ofl',    'Anton-Regular.ttf',           'Anton 重磅窄体',    'VJ Anton',         0, '极窄极重，字距紧，力量感强'],
  ['archivoblack',    'ofl',    'ArchivoBlack-Regular.ttf',    'Archivo 重磅',      'VJ ArchivoBlack',  0, '经典无衬线超粗，干净有力'],
  ['rubikbeastly',    'ofl',    'RubikBeastly-Regular.ttf',    'Rubik 锯齿',        'VJ RubikBeastly',  0, '边缘全是锯齿，攻击性最强的拉丁款'],
  ['rubikburned',     'ofl',    'RubikBurned-Regular.ttf',     'Rubik 烧灼',        'VJ RubikBurned',   0, '边缘像被烧穿，配熔岩材质很搭'],
  ['rubikglitch',     'ofl',    'RubikGlitch-Regular.ttf',     'Rubik 故障',        'VJ RubikGlitch',   0, '电子故障感，切碎重影'],
  ['rubikpuddles',    'ofl',    'RubikPuddles-Regular.ttf',    'Rubik 液态',        'VJ RubikPuddles',  0, '笔画像融化摊开，hiphop 珠宝那味'],
  ['rubikiso',        'ofl',    'RubikIso-Regular.ttf',        'Rubik 等高线',      'VJ RubikIso',      0, '笔画里有等高线纹，像地形图'],
  ['tiltneon',        'ofl',    'TiltNeon[XROT,YROT].ttf',     'Tilt 霓虹管',       'VJ TiltNeon',      0, '可变字体，笔画就是霓虹灯管'],
  ['tiltwarp',        'ofl',    'TiltWarp[XROT,YROT].ttf',     'Tilt 扭曲',         'VJ TiltWarp',      0, '可变字体，笔画自带扭曲张力'],
  ['monoton',         'ofl',    'Monoton-Regular.ttf',         'Monoton 复古线',    'VJ Monoton',       0, '平行线构成的复古未来感'],
  ['bangers',         'ofl',    'Bangers-Regular.ttf',         'Bangers 漫画',      'VJ Bangers',       0, '美漫拟声词那种冲击感'],
  ['fasterone',       'ofl',    'FasterOne-Regular.ttf',       'Faster 速度线',     'VJ FasterOne',     0, '笔画带速度尾迹'],
  ['blackopsone',     'ofl',    'BlackOpsOne-Regular.ttf',     '军事模板',          'VJ BlackOps',      0, '军用喷漆模板字，硬朗'],
  ['russoone',        'ofl',    'RussoOne-Regular.ttf',        'Russo 科技',        'VJ RussoOne',      0, '科技感无衬线，适合电子乐'],
  ['metalmania',      'ofl',    'MetalMania-Regular.ttf',      '金属乐队',          'VJ MetalMania',    0, '重金属乐队 logo 风'],
  ['zcoolqingkehuangyou', 'ofl', 'ZCOOLQingKeHuangYou-Regular.ttf', '站酷庆科黄油体', 'VJ ZCOOLQingKe', 1, '★中文里最街头的一款，笔画粗壮有张力'],
  ['zcoolkuaile',         'ofl', 'ZCOOLKuaiLe-Regular.ttf',         '站酷快乐体',     'VJ ZCOOLKuaiLe', 1, '圆头手写，轻松活泼'],
  ['mashanzheng',         'ofl', 'MaShanZheng-Regular.ttf',         '马善政毛笔楷书', 'VJ MaShanZheng', 1, '毛笔楷书，配金属材质像参考图那种书法金属字'],
  ['zhimangxing',         'ofl', 'ZhiMangXing-Regular.ttf',         '志莽行书',       'VJ ZhiMangXing', 1, '行书飞白，最有书法攻击性'],
];

const manifest = [];
let total = 0, ok = 0, skip = 0, bad = 0;

for (const [dir, bucket, file, label, family, cjk, note] of PICKS) {
  const out = path.join(CONTENT, file);
  let size = 0;
  if (fs.existsSync(out) && fs.statSync(out).size > 1024) {
    size = fs.statSync(out).size; skip++;
    console.log(`  跳过 ${file.padEnd(34)} ${(size/1024).toFixed(1).padStart(8)} KB`);
  } else {
    try {
      const { buf, host } = await grab(bucket, dir, file);
      fs.writeFileSync(out, buf);
      size = buf.length; ok++;
      console.log(`  ✓ 下载 ${file.padEnd(34)} ${(size/1024).toFixed(1).padStart(8)} KB  (${host})`);
    } catch (e) {
      bad++;
      console.log(`  ✗ 失败 ${file}  ${e.message}`);
      continue;
    }
  }
  total += size;
  manifest.push({
    file, label, family, cjk: !!cjk, note,
    dir, bucket,
    sizeKB: Math.round(size / 1024),
    license: bucket === 'ofl' ? 'SIL Open Font License 1.1' : 'Apache License 2.0',
    source: `https://github.com/google/fonts/tree/main/${bucket}/${dir}`,
  });
}

fs.writeFileSync(path.join(CONTENT, 'fonts.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(path.join(HERE, 'fonts.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n新增 ${ok} · 已存在 ${skip} · 失败 ${bad} · 合计 ${(total/1024/1024).toFixed(1)} MB`);
console.log(`清单已写入 content/fonts.json（${manifest.length} 款）`);
