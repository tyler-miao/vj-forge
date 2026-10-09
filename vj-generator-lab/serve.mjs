#!/usr/bin/env node
/*
 * 本地预览服务器。
 *
 * 为什么不能直接双击打开 prototype/latest.html：
 * 它里面的模块路径是写死的绝对路径 ——
 *     /files/trace-contours.js … /files/graffiti-outline.js
 *     /files/fonts.json
 * file:// 协议下这些路径根本不存在，模块加载会直接失败。
 *
 * 这个脚本就是把仓库里散在 src/ 和 prototype/ 的文件，
 * 拍平成原型期望的那一个 /files/ 目录，用任意端口起个静态服务。
 *
 *   node serve.mjs            # 默认 5390
 *   PORT=8080 node serve.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5390);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.bin':  'application/octet-stream'
};

/** 白名单：只认这几处，不暴露仓库其它路径 */
const ROUTES = new Map();
const put = (route, file) => { if (fs.existsSync(file)) ROUTES.set(route, file); };

put('/',                path.join(HERE, 'prototype', 'latest.html'));
put('/index.html',      path.join(HERE, 'prototype', 'latest.html'));
put('/files/latest.html', path.join(HERE, 'prototype', 'latest.html'));
put('/files/fonts.json',  path.join(HERE, 'fonts', 'fonts.json'));
for (const f of fs.readdirSync(path.join(HERE, 'src')))
  if (f.endsWith('.js')) put('/files/' + f, path.join(HERE, 'src', f));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = ROUTES.get(url);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + url);
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('vj-forge 预览已起：');
  for (const r of ROUTES.keys()) console.log('  http://localhost:' + PORT + r);
});
