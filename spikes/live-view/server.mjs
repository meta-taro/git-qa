// ライブ映像の埋め込み方式を確かめるためのスパイク（Issue 003）。
//
// scrcpy は「生 H.264（Annex-B）を 1 本のストリームで吐く」。**同じ形を ffmpeg で作れば、
// Android 実機が無くても方式の検証ができる。**ここで確かめたいのは端末との接続ではなく、
// 「その映像を GUI の中に遅延なく出せるか」だけ。
//
// 依存を足さないために、WebSocket ではなく HTTP の chunked で流す（fetch のストリームで読める）。
//
//   node spikes/live-view/server.mjs
//   → http://127.0.0.1:8787/

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 60;

const INDEX = fileURLToPath(new URL('./index.html', import.meta.url));

/** scrcpy の出力に似せた生 H.264（Annex-B）を作る。`-re` で実時間に合わせて流す。 */
const spawnFfmpeg = () =>
  spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'lavfi',
      // testsrc2 は画面内に経過時間を出す。撮った絵から「今どこか」が読める。
      '-i',
      `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      // zerolatency は sliced-threads を立てる＝1 フレームが複数スライスに割れる。
      // Android の MediaCodec（scrcpy の出どころ）は 1 フレーム 1 スライスなので、そちらに寄せる。
      '-x264-params',
      'sliced-threads=0',
      // 1 秒ごとに IDR。途中から繋いでも 1 秒以内に絵が出る（scrcpy も同様の作り）
      '-g',
      String(FPS),
      '-pix_fmt',
      'yuv420p',
      '-f',
      'h264',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

const server = createServer((req, res) => {
  // クエリ文字列は落として見る。同じ計測を別タブで開き直すために ?run=... を付けるので、
  // 付けた途端に 404 になると測り直しができない。
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/' || path === '/index.html') {
    readFile(INDEX)
      .then((html) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      })
      .catch(() => {
        res.writeHead(500);
        res.end('index.html が読めない');
      });
    return;
  }

  if (path === '/stream.h264') {
    const ff = spawnFfmpeg();
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      // proxy に溜め込ませない。溜まると測っているのが自分の遅延でなくなる。
      'x-accel-buffering': 'no',
    });
    ff.stdout.pipe(res);
    const stop = () => ff.kill('SIGKILL');
    res.on('close', stop);
    ff.on('error', (error) => {
      console.error('ffmpeg を起動できない:', error.message);
      res.destroy();
    });
    return;
  }

  // 測った値の持ち出し口。
  // 画面に出ている数字は、Tauri のウィンドウの中では人が見る以外に読み出せない。
  // ページ側から投げさせて、ここへ 1 行で出す（webview ごとの値を並べて比べるため）。
  if (path === '/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      console.log(`[report] ${body}`);
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[live-view spike] http://127.0.0.1:${PORT}/`);
});
