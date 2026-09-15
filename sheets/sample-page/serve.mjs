/**
 * 見本のシート（`sheets/web-sample-ja.tsv`）が指している相手を、手元で出す。
 *
 * **参照だけ足して、実体を置かない形にしない**（product-baseline §23）。
 * シートは `http://127.0.0.1:8731/page.html` を見に行くので、ここがそれを出す。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8731;
const here = dirname(fileURLToPath(import.meta.url));

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  if (path !== '/page.html' && path !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('そのページは無い（/page.html だけを出す）\n');
    return;
  }
  readFile(join(here, 'page.html'), 'utf8').then(
    (body) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
    },
    (reason) => {
      // **握り潰さない。**出せない理由が分からないと、シートの側を疑い始める。
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`見本のページを読めない: ${String(reason)}\n`);
    },
  );
});

// 外へは出さない。**見本のために、機械の外へ口を開けない。**
server.listen(PORT, '127.0.0.1', () => {
  console.log(`見本のページ: http://127.0.0.1:${String(PORT)}/page.html`);
});
