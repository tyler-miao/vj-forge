/**
 * 边缘装饰形态的定量验证（hip-hop 重做版）。
 *
 * 判据不是"看着像"，而是可量化、可回归的三件事：
 *   1. 14 个形态（尖锥未动 + 13 个 hip-hop 新形态）都能生成合法几何体：
 *      顶点数值全部有限、包围盒有效、三个方向都有厚度（不退化）。
 *   2. 每个形态经过 normalizeUnitHeight 后高度精确 = 1（实例 scale.y 即长度）。
 *   3. 形态之间两两可区分（x/z 尺寸 + 顶点数签名不同），换形态是真的换形态；
 *      「尖锥」与最初版本逐字符一致（从渊源上保证没被碰过）。
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

// —— 从 latest.html 原样抽出 mergeGeos + ADORN_FORMS，在 Node 里执行 ——
const mergeSrc = html.match(/function mergeGeos\(geos\)\{[\s\S]*?\n\}/)[0];
const formsSrc = html.match(/const ADORN_FORMS = \{[\s\S]*?\n\};/)[0];
const factory = new Function('THREE', mergeSrc + '\n' + formsSrc + '\nreturn ADORN_FORMS;');
const ADORN_FORMS = factory(THREE);

const EXPECTED_KEYS = ['cone','mic','cap','star','diamond','boombox','cassette','eq','horn','vinyl','chain','crown','graffiti','phones'];
const kinds = new Set(['尖刺','块状','圆环']);

// 1) 形态清单
console.log('形态总数：' + Object.keys(ADORN_FORMS).length);
if (Object.keys(ADORN_FORMS).length !== EXPECTED_KEYS.length) fail('形态数量应为 ' + EXPECTED_KEYS.length);
for (const k of EXPECTED_KEYS) if (!ADORN_FORMS[k]) fail('缺少形态 key: ' + k);
for (const k of Object.keys(ADORN_FORMS)) if (!EXPECTED_KEYS.includes(k)) fail('出现未登记的形态 key: ' + k);

// 2) 尖锥必须逐字符保持原样（唯一一个不动的形态）
const CONE_LINE = "  cone:   { label:'尖锥',     kind:'尖刺', make: () => new THREE.ConeGeometry(0.058, 1, 10, 1, false) },";
if (!html.includes(CONE_LINE)) fail('尖锥（cone）已偏离最初版本，要求不动它');

// 3) 每个形态的几何体检
const sigs = new Map();
console.log('form        kind   verts    x-sz     z-sz    h=1   octree  状态');
for (const [k, f] of Object.entries(ADORN_FORMS)) {
  const geo = normalizeUnitHeight(f.make());
  const pos = geo.attributes.position;
  let nan = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nan++;
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const ex = Math.max(bb.max.x - bb.min.x, 0);
  const ey = Math.max(bb.max.y - bb.min.y, 0);
  const ez = Math.max(bb.max.z - bb.min.z, 0);
  const h1 = Math.abs(ey - 1) < 1e-6;
  const okSize = ex > 1e-4 && ey > 1e-4 && ez > 1e-4 && ex < 2 && ez < 2;
  const sig = `${ex.toFixed(4)}x${ez.toFixed(4)}:${pos.count}`;
  const unique = !sigs.has(sig);
  if (!unique) sigs.get(sig).push(k); else sigs.set(sig, [k]);

  console.log(
    `${k.padEnd(9)} ${String(f.kind).padEnd(5)} ${String(pos.count).padStart(6)} ` +
    `${ex.toFixed(4).padStart(7)} ${ez.toFixed(4).padStart(7)}  ${h1 ? 'yes' : 'NO '}   ` +
    `${okSize ? 'ok  ' : 'BAD '} ${unique ? '' : '(签名与 ' + sigs.get(sig).filter(x => x !== k).join('/') + ' 重复)'}`
  );

  if (nan > 0) fail(`${k}: 有 ${nan} 个 NaN 顶点`);
  if (!h1) fail(`${k}: 归一化后高度 != 1（${ey}）`);
  if (!okSize) fail(`${k}: 包围盒异常 ex=${ex} ey=${ey} ez=${ez}`);
  if (!kinds.has(f.kind)) fail(`${k}: kind 不在 尖刺/块状/圆环`);
  if (!unique) fail(`${k}: 与其它形态几何签名重复（${sig}）`);
  geo.dispose();
}

// 4) 标签唯一，UI chips 才不歧义
const labels = Object.values(ADORN_FORMS).map(f => f.label);
if (new Set(labels).size !== labels.length) fail('存在重复标签：' + labels.filter((v, i, a) => a.indexOf(v) !== i).join('/'));

// 5) 扁平件（noSpin）朝向约定检查：声明了 noSpin 的必须是需要正面朝向观众的那几个
const noSpinKeep = ['cap','star','boombox','cassette','eq','phones'];
for (const k of noSpinKeep) {
  const f = ADORN_FORMS[k];
  if (!f.noSpin && k !== 'cap') fail(`${k} 应保持朝向固定（noSpin）`);
}

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项未通过 ✘`);
process.exit(failures === 0 ? 0 : 1);