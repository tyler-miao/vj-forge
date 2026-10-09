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
 * 这个脚本把仓库里散在 src/ 和 prototype/ 的文件，拍平成原型期望的那一个 /files/ 目录。
 *
 *   node serve.mjs                 # 只本机可访问，默认 5390
 *   PORT=8080 node serve.mjs       # 换端口
 *   HOST=0.0.0.0 node serve.mjs    # 开放给局域网，方便用别的设备 / 手机投屏
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5390);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.bin':  'application/octet-stream'
};

/** 白名单：只认这几处，不把整个仓库暴露出去 */
const ROUTES = new Map();
const put = (route, file) => { if (fs.existsSync(file)) ROUTES.set(route, file); };

put('/',                  path.join(HERE, 'prototype', 'latest.html'));
put('/index.html',        path.join(HERE, 'prototype', 'latest.html'));
put('/files/latest.html', path.join(HERE, 'prototype', 'latest.html'));
put('/files/fonts.json',  path.join(HERE, 'fonts', 'fonts.json'));
for (const f of fs.readdirSync(path.join(HERE, 'src')))
  if (f.endsWith('.js')) put('/files/' + f, path.join(HERE, 'src', f));

if (ROUTES.size === 0) {
  console.error('没找到 prototype/ 或 src/，请在 vj-generator-lab 目录下运行。');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = ROUTES.get(url);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + url + '\n');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换个端口：PORT=5391 npm run serve`);
  } else {
    console.error(e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('vj-forge 预览已起：');
  for (const r of ROUTES.keys()) console.log(`  http://localhost:${PORT}${r}`);

  if (HOST === '0.0.0.0' || HOST === '::') {
    const nets = Object.values(os.networkInterfaces()).flat() || [];
    const lan = nets.filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
    if (lan.length) {
      console.log('\n局域网访问（别的设备 / 投屏用）：');
      for (const ip of lan) console.log(`  http://${ip}:${PORT}/`);
    } else {
      console.log('\n没检测到局域网网卡地址。');
    }
  } else {
    console.log('\n只监听 127.0.0.1，别的设备连不上。要投屏：HOST=0.0.0.0 npm run serve');
  }
  console.log('\nCtrl+C 停止');
});
