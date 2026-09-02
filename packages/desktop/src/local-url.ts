/**
 * 起動時に渡された URL を、繋いでよいものだけに絞る。
 *
 * **受け取った文字列をそのまま fetch しない。**ここを流れるのは検証中の端末の画面と、
 * 人が置いた判定（PRD §10）。**localhost 以外・http 以外へは繋がない。**
 *
 * 映像（`?live=`）と制御（`?control=`）で同じ規則を使う。
 * **2 箇所に書くと、片方だけ緩んでも気づけない。**
 */
export function localHttpUrlFromLocation(search: string, name: string): string | undefined {
  const raw = new URLSearchParams(search).get(name);
  if (raw === null || raw === '') return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return local && url.protocol === 'http:' ? url.toString() : undefined;
}
