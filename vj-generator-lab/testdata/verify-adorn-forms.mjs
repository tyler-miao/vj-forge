/**
 * 边缘装饰形态的定量验证（外轮廓重做版）。
 *
 * 这一栏从「14 种立体装饰件」收缩成了「尖锥 + 字体自身外轮廓」，
 * 所以验证的重点从"两两可区分"改成了三条：
 *
 *   1. **尖锥原样不动** —— 定义行逐字符一致，几何体逐顶点一致。
 *      它是用户点名保留的唯一形态，任何顺手的"优化"都算回归。
 *   2. **旧的 13 种全部退场** —— 麦克风 / 音响 / 磁带 / 黑胶 / 皇冠 / 耳机 …
 *      一个都不许残留（包括 UI chips 和 mergeGeos 这类只有它们在用的工具函数）。
 *      它们是"摆在字体旁边的独立装饰物"，正是这次要否定的东西。
 *   3. 尖锥的几何体检仍然有效：顶点有限、归一化后高度精确 = 1、三向有厚度。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { normalizeUnitHeight } from '../src/edge-adornments.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'prototype', 'latest.html'), 'utf8');

let failures = 0;
const fail = (msg) => { console.log('   ✗ ' + msg); failures++; };

// —— 从 latest.html 原样抽出 ADORN_FORMS，在 Node 里执行 ——
const formsSrc = html.match(/const ADORN_FORMS = \{[\s\S]*?\n\};/);
if (!formsSrc) { fail('找不到 ADORN_FORMS'); process.exit(1); }
const factory = new Function('THREE', formsSrc[0] + '\nreturn ADORN_FORMS;');
const ADORN_FORMS = factory(THREE);

const EXPECTED_KEYS = ['cone'];

// 1) 形态清单：只剩尖锥
console.log('形态总数：' + Object.keys(ADORN_FORMS).length);
if (Object.keys(ADORN_FORMS).length !== EXPECTED_KEYS.length) fail('形态数量应为 ' + EXPECTED_KEYS.length);
for (const k of EXPECTED_KEYS) if (!ADORN_FORMS[k]) fail('缺少形态 key: ' + k);
for (const k of Object.keys(ADORN_FORMS)) if (!EXPECTED_KEYS.includes(k)) fail('出现未登记的形态 key: ' + k);

// 2) 尖锥必须逐字符保持原样（唯一一个不动的形态）
const CONE_LINE = "  cone:   { label:'尖锥',     kind:'尖刺', make: () => new THREE.ConeGeometry(0.058, 1, 10, 1, false) },";
if (!html.includes(CONE_LINE)) fail('尖锥（cone）已偏离最初版本，要求不动它');
else console.log('   ✓ 尖锥定义行逐字符一致');

// 3) 旧的 13 种必须彻底消失 —— 形态表、chips 数据源、专属工具函数三处都查
const RETIRED = ['mic', 'cap', 'star', 'spray', 'boombox', 'cassette', 'eq', 'horn',
                 'vinyl', 'chain', 'crown', 'graffiti', 'phones'];
const RETIRED_LABELS = ['麦克风', '棒球帽', '音响', '喷漆', '磁带', '黑胶', '皇冠', '耳机'];
for (const k of RETIRED) {
  const re = new RegExp('\\b' + k + '\\s*:\\s*\\{\\s*label\\s*:');
  if (re.test(html)) fail(`已移除的形态 ${k} 又出现在 latest.html 里了`);
}
// 形态标签只可能出现在 ADORN_FORMS（chips 的唯一数据源）里，
// 不去全 HTML 搜 —— 注释和新滑块的标签也会用到这些词。
for (const l of RETIRED_LABELS) if (formsSrc[0].includes(l)) fail(`已移除的形态标签「${l}」残留在 ADORN_FORMS 里`);
if (!Object.values(ADORN_FORMS).every(f => f.label && f.kind && typeof f.make === 'function'))
  fail('ADORN_FORMS 里有条目缺 label / kind / make');
if (/function\s+mergeGeos\s*\(/.test(html)) fail('mergeGeos 只服务于已删除的装饰件，应一并移除');
if (!failures) console.log('   ✓ 13 种旧装饰件已彻底退场（形态表 / 标签 / 专属工具函数）');

// 4) 只剩尖锥这一条路在跑，它的几何体检照旧有效
const geo = normalizeUnitHeight(ADORN_FORMS.cone.make());
const pos = geo.attributes.position;
let nan = 0;
for (let i = 0; i < pos.count; i++) {
  if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nan++;
}
geo.computeBoundingBox();
const bb = geo.boundingBox;
const ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
const h1 = Math.abs(ey - 1) < 1e-6;
const okSize = ex > 1e-4 && ey > 1e-4 && ez > 1e-4 && ex < 2 && ez < 2;
console.log(`cone      顶点 ${pos.count}  尺寸 ${ex.toFixed(4)}×${ey.toFixed(4)}×${ez.toFixed(4)}  归一化 h=1 ${h1 ? 'yes' : 'NO'}`);
if (nan > 0) fail(`cone: 有 ${nan} 个 NaN 顶点`);
if (!h1) fail(`cone: 归一化后高度 != 1（${ey}）`);
if (!okSize) fail(`cone: 包围盒异常 ex=${ex} ey=${ey} ez=${ez}`);
if (ADORN_FORMS.cone.kind !== '尖刺') fail('cone.kind 应保持「尖刺」');
if (!failures) console.log('   ✓ 尖锥几何体检通过');

geo.dispose();
console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项未通过 ✘`);
process.exit(failures === 0 ? 0 : 1);
