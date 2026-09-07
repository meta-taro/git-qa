/**
 * 押す（C57）。**宛先はアプリであって、画面ではない。**
 *
 * 最初は System Events の `click at {x, y}` で押していた。あれは**画面の座標**へ送るので、
 * 窓が隠れていると手前の別アプリが受け取る。実際に Google Chrome のツールバーと
 * warifu の窓を押した。避けるために毎回そのアプリを前面へ出していたが、
 * **人には「押すたびに相手が一番上に来る」ように見えた**（2026-09-07 の指摘）。
 *
 * `CGEventPostToPid` は**指定したプロセスにだけ**出来事を届ける。
 * 前面に出さない。並び順を気にしない。元の窓へ戻す必要もない。
 * 隠れたままでも押せる。
 */

/** `CGEventType`。押す / 離すの 2 つだけ使う。 */
const kCGEventLeftMouseDown = 1;
const kCGEventLeftMouseUp = 2;

export function clickScript(pid: number, x: number, y: number): string {
  const at = `{x: ${String(Math.round(x))}, y: ${String(Math.round(y))}}`;
  return [
    "ObjC.import('CoreGraphics');",
    // 第 1 引数は event source。null（既定の source）で足りる。
    "ObjC.bindFunction('CGEventCreateMouseEvent', ['void*', ['void*', 'int', '{CGPoint=dd}', 'int']]);",
    "ObjC.bindFunction('CGEventPostToPid', ['void', ['int', 'void*']]);",
    `var pid = ${String(Math.round(pid))};`,
    `var down = $.CGEventCreateMouseEvent($(), ${String(kCGEventLeftMouseDown)}, ${at}, 0); // kCGEventLeftMouseDown`,
    `var up = $.CGEventCreateMouseEvent($(), ${String(kCGEventLeftMouseUp)}, ${at}, 0); // kCGEventLeftMouseUp`,
    '$.CGEventPostToPid(pid, down);',
    '$.CGEventPostToPid(pid, up);',
    '"ok";',
  ].join('\n');
}
