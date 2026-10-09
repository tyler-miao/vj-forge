/**
 * 仓库体检：把「人肉检查」固化成断言，防止同类问题再混进历史。
 *
 *  要拦的三类坑（都真实发生过）：
 *   1. 文本文件被存成 UTF-16 —— git 判成二进制，GitHub 上直接显示成乱码
 *   2. 文本文件带 UTF-8 BOM —— .gitignore 的 BOM 会干扰首行模式解析
 *   3. README 代码围栏不配对 / 相对链接指向不存在的文件 —— GitHub 上整段渲染错乱
 *
 *  另外只读文本扩展名，二进制（.bin/.png/.ttf）一律跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');           // vj-generator-lab/
const REPO = path.resolve(ROOT, '..');           // 仓库根

const SKIP_DIR = new Set(['.git', 'node_modules', '.npm-cache', '.superpowers', 'dist']);
const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.json', '.py', '.html', '.css', '.yml', '.yaml', '.txt', '.sh']);
const TEXT_NAME = new Set(['.gitignore', '.gitattributes', '.npmrc', '.editorconfig']);

let fail = 0, warn = 0;
const bad = (m) => { console.log('  \u2717 ' + m); fail++; };
const ok   = (m) => { console.log('  \u2713 ' + m); };
const note = (m) => { console.log('  !  ' + m); warn++; };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), out); continue; }
    out.push(path.join(dir, e.name));
  }
  return out;
}

/* ---------- 1/2: 编码与 BOM ---------- */
console.log('[1] 编码 / BOM');
const files = walk(REPO);
let utf16 = [], bom = [], textCount = 0;
for (const p of files) {
  const ext = path.extname(p).toLowerCase();
  const isText = TEXT_EXT.has(ext) || TEXT_NAME.has(path.basename(p));
  if (!isText) continue;
  textCount++;
  const b = fs.readFileSync(p);
  const rel = path.relative(REPO, p).split(path.sep).join('/');
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) utf16.push(rel);
  else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bom.push(rel);
}
if (utf16.length) bad('UTF-16 文件（GitHub 上是乱码）：' + utf16.join(', ')); else ok(`无 UTF-16 文件`);
if (bom.length)   bad('带 UTF-8 BOM：' + bom.join(', ')); else ok('无 UTF-8 BOM');
ok(`扫描了 ${textCount} 个文本文件`);

/* ---------- 3: README 围栏与内链 ---------- */
console.log('[2] Markdown 结构');
for (const rel of ['README.md', 'vj-generator-lab/README.md']) {
  const p = path.join(REPO, rel.split('/').join(path.sep));
  if (!fs.existsSync(p)) { bad(`${rel} 不存在`); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n');

  // 围栏必须成对，且必须顶格（行首带文字的 ``` 不算围栏，会把后面整段拖进代码块）
  const fences = lines.filter(l => /^```/.test(l));
  const inlineFence = lines.map((l, i) => [l, i]).filter(([l]) => /```/.test(l) && !/^```/.test(l));
  if (fences.length % 2 !== 0) bad(`${rel}：代码围栏 ${fences.length} 个（奇数，未闭合）`);
  else ok(`${rel}：围栏 ${fences.length} 个，配对正常`);
  for (const [, i] of inlineFence) bad(`${rel} 第 ${i + 1} 行：\`\`\` 不在行首，会被当成普通文字`);

  // 相对链接必须指向真实文件
  const links = [...fs.readFileSync(p, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  const broken = links.filter(u => !/^(https?:|mailto:|#)/.test(u))
    .filter(u => !fs.existsSync(path.join(path.dirname(p), u.split('/').join(path.sep))));
  if (broken.length) bad(`${rel}：断链 ${broken.join(', ')}`);
  else ok(`${rel}：${links.length} 个链接全部可达`);
}

/* ---------- 汇总 ---------- */
if (fail) { console.log(`\n体检不通过：${fail} 项失败、${warn} 项提醒`); process.exit(1); }
console.log(`\n体检通过${warn ? `（${warn} 项提醒）` : ''}`);
