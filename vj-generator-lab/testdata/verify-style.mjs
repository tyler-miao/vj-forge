/**
 * 字形几何变形的定量验证。
 *
 * 判据不是"看着像"，而是 Steiner 公式：小量外扩 d 时，面积增量应约等于 P·d
 * （P 为周长）。这能一次性验证法线方向、斜接长度、绕向归一化是否全对 ——
 * 符号搞反的话面积会变小，立刻暴露。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceContours } from '../src/trace-contours.js';
import {
  stylizeGroups, materialArea, totalPerimeter, hasNaN, ringArea
} from '../src/stylize-contours.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(HERE, 'index.json'), 'utf8'));

const STYLE = { dilate: 0, spike: 0, shear: 0, arch: 0 };
let failures = 0;
const fail = (msg) => { console.log('   ✗ ' + msg); failures++; };

console.log('case   text     A0       P       外扩0.02 实测ΔA   预期P·d    比值   内缩ΔA   尖刺ΔA');
console.log('------------------------------------------------------------------------------------------');

for (const c of index) {
  const buf = fs.readFileSync(path.join(HERE, c.name + '.bin'));
  const alpha = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const res = traceContours(alpha, c.width, c.height);
  const norm = 1 / Math.max(res.bbox.inkH, 1);
  const base = res.groups.map(g => ({
    outer: g.outer.map(p => ({ x: p.x * norm, y: p.y * norm })),
    holes: g.holes.map(h => h.map(p => ({ x: p.x * norm, y: p.y * norm })))
  }));

  const A0 = materialArea(base);
  const P = totalPerimeter(base);
  const d = 0.02;

  const out = stylizeGroups(base, { ...STYLE, dilate: d });
  const inn = stylizeGroups(base, { ...STYLE, dilate: -d });
  const spk = stylizeGroups(base, { ...STYLE, spike: 1.0 });

  const Aout = materialArea(out), Ain = materialArea(inn), Aspk = materialArea(spk);
  const dOut = Aout - A0, dIn = Ain - A0, dSpk = Aspk - A0;
  const expect = P * d;
  const ratio = dOut / expect;

  console.log(
    `${c.name}  ${c.text.padEnd(7)} ${A0.toFixed(3)}  ${P.toFixed(2)}  ` +
    `${dOut >= 0 ? '+' : ''}${dOut.toFixed(4)}      ${expect.toFixed(4)}   ${ratio.toFixed(2)}  ` +
    `${dIn >= 0 ? '+' : ''}${dIn.toFixed(4)}  ${dSpk >= 0 ? '+' : ''}${dSpk.toFixed(4)}`
  );

  // 1) 外扩必须让材质变大，且量级符合 P·d（允许 0.5~2 倍，因为尖角斜接会多算）
  if (dOut <= 0) fail(`${c.text}: 外扩后面积没变大（法线方向反了？）`);
  if (ratio < 0.5 || ratio > 2.0) fail(`${c.text}: 外扩面积增量 ${ratio.toFixed(2)}×P·d，超出合理范围`);

  // 2) 内缩必须让材质变小
  if (dIn >= 0) fail(`${c.text}: 内缩后面积没变小`);

  // 3) 尖角延伸只能让面积增加
  if (dSpk < 0) fail(`${c.text}: 尖角延伸让面积变小了`);

  // 4) 不能出现非法坐标
  if (hasNaN(out) || hasNaN(inn) || hasNaN(spk)) fail(`${c.text}: 变形后出现 NaN/Infinity`);

  // 5) 顶点数必须守恒（变形不能增删点）
  for (const grp of [out, inn, spk]) {
    if (grp.length !== base.length) fail(`${c.text}: 轮廓条数变了`);
    for (let i = 0; i < grp.length; i++) {
      if (grp[i].outer.length !== base[i].outer.length) fail(`${c.text}: 外轮廓顶点数变了`);
      if (grp[i].holes.length !== base[i].holes.length) fail(`${c.text}: 洞数变了`);
    }
  }

  // 6) 绕向必须保持（后续依赖它，破坏了会导致渲染内外翻转）
  for (let i = 0; i < out.length; i++) {
    if (Math.sign(ringArea(out[i].outer)) !== Math.sign(ringArea(base[i].outer)))
      fail(`${c.text}: 外轮廓绕向被改变`);
    for (let j = 0; j < out[i].holes.length; j++) {
      if (Math.sign(ringArea(out[i].holes[j])) !== Math.sign(ringArea(base[i].holes[j])))
        fail(`${c.text}: 洞的绕向被改变`);
    }
  }

  // 7) 斜切面积守恒（变换的行列式为 1）
  const shr = stylizeGroups(base, { ...STYLE, shear: 0.25 });
  const dShr = Math.abs(materialArea(shr) - A0) / A0;
  if (dShr > 0.02) fail(`${c.text}: 斜切改变了 ${(dShr * 100).toFixed(1)}% 面积，应该基本守恒`);
}

console.log('------------------------------------------------------------------------------------------');
if (failures === 0) {
  console.log('全部通过：法线方向、斜接、绕向、面积守恒都对得上');
} else {
  console.log(`${failures} 项未通过`);
  process.exit(1);
}
