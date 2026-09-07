/**
 * 押す（C57）。**前面へ出す・出るのを待つ・押す、を 1 本の script でやる。**
 *
 * osascript の呼び出しは 1 回 250 ms 前後かかる（実測 2026-09-07）。
 * これを 4 回に分けていたので、1 押しに 1 秒以上乗り、
 * 人には「反応したのか、遅れているのか分からない」動きに見えた。
 *
 * **前面に出すのは飾りではない。**押す座標は画面全体の座標なので、
 * 隠れていれば手前の別アプリが受け取る。実際に Google Chrome のツールバーと
 * warifu の窓を押した。**出られなかったら押さない。**
 */

/** 前面に出られなかったときに script が返す目印。**押していない**ことを表す。 */
export const NOT_FRONT_MARK = 'git-qa:not-frontmost';

export function clickScript(app: string, x: number, y: number): string {
  const name = JSON.stringify(app);
  return [
    'tell application "System Events"',
    // **人が見ていた窓を覚えておく。**押したあと、そこへ戻す。
    '  set wasFront to name of first process whose frontmost is true',
    'end tell',
    `tell application ${name} to activate`,
    'tell application "System Events"',
    // `activate` は前面に出る前に返る。**出るまで待つ。**
    '  repeat 25 times',
    `    if (name of first process whose frontmost is true) is ${name} then exit repeat`,
    '    delay 0.02',
    '  end repeat',
    `  if (name of first process whose frontmost is true) is not ${name} then`,
    `    return "${NOT_FRONT_MARK} " & (name of first process whose frontmost is true)`,
    '  end if',
    `  click at {${String(Math.round(x))}, ${String(Math.round(y))}}`,
    // **奪ったままにしない。**戻すのを別の osascript にすると 250 ms 増えるので、ここでやる。
    `  if wasFront is not ${name} then`,
    '    set frontmost of process wasFront to true',
    '  end if',
    'end tell',
    '"ok"',
  ].join('\n');
}

/**
 * なぞる（スクロール）。
 *
 * **2026-09-07 まで一度も効いていなかった。**
 * `tell application "System Events" to scroll {0, N} at {x, y}` と書いてあったが、
 * **`System Events` に `scroll` という命令は無い。**実行時に構文エラーになるだけで、
 * 検査では捕まらない形だった。人が 22 回なぞって、22 回とも落ちていた。
 *
 * 滑車の出来事は、**いま指が乗っている窓**へ届く。だから先に指の位置を運ぶ。
 * そのためには相手が手前に居る必要があるので、押すときと同じく前面へ出して、戻す。
 */
export function scrollScript(app: string, x: number, y: number, lines: number): string {
  const name = JSON.stringify(app);
  // 人が上へなぞった（`lines` が正）＝ 先を見たい ＝ 滑車は負へ回す。
  const wheel = String(-Math.round(lines));
  return [
    "ObjC.import('CoreGraphics');",
    "ObjC.bindFunction('CGEventCreateMouseEvent', ['void*', ['void*', 'int', '{CGPoint=dd}', 'int']]);",
    "ObjC.bindFunction('CGEventCreateScrollWheelEvent2', ['void*', ['void*', 'int', 'int', 'int', 'int', 'int']]);",
    "ObjC.bindFunction('CGEventPost', ['void', ['int', 'void*']]);",
    'var se = Application("System Events");',
    // 押すときと同じく、人が見ていた窓を覚えておいて戻す。
    'var wasFront = se.processes.whose({ frontmost: true })[0].name();',
    `Application(${name}).activate();`,
    'for (var i = 0; i < 25; i++) {',
    `  if (se.processes.whose({ frontmost: true })[0].name() === ${name}) break;`,
    '  delay(0.02);',
    '}',
    // 5 = kCGEventMouseMoved、1 = kCGScrollEventUnitLine。
    `$.CGEventPost(0, $.CGEventCreateMouseEvent($(), 5, {x: ${String(Math.round(x))}, y: ${String(Math.round(y))}}, 0));`,
    'delay(0.03);',
    `$.CGEventPost(0, $.CGEventCreateScrollWheelEvent2($(), 1, 1, ${wheel}, 0, 0));`,
    `if (wasFront !== ${name}) { se.processes.byName(wasFront).frontmost = true; }`,
    '"ok";',
  ].join('\n');
}

/**
 * 掴んで運ぶ（DnD）。
 *
 * **2026-09-07 まで、実装が無かった。**「持っていない」と言って止まっていた。
 *
 * 押すのは AX の要素を直接押せるので、前面に出さずに済む（`git-qa-input`）。
 * **なぞる・掴んで運ぶには、その口が無い** —— 実測で `AXScrollArea` に
 * スクロールバーも `AXValue` も出ていなかった。実際のマウス操作を送るしかない。
 *
 * ただし**1 回の操作で、前面に出すのは 1 回だけ。**押して・運んで・離すまでを
 * 1 本の script でやる。**途中で焦点が動くと、掴んだものが落ちる。**
 */
export function dragScript(
  app: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  const name = JSON.stringify(app);
  const x1 = Math.round(fromX);
  const y1 = Math.round(fromY);
  const x2 = Math.round(toX);
  const y2 = Math.round(toY);
  return [
    "ObjC.import('CoreGraphics');",
    "ObjC.bindFunction('CGEventCreateMouseEvent', ['void*', ['void*', 'int', '{CGPoint=dd}', 'int']]);",
    "ObjC.bindFunction('CGEventPost', ['void', ['int', 'void*']]);",
    'var LEFT_DOWN = 1, LEFT_UP = 2, LEFT_DRAGGED = 6, MOVED = 5;',
    // 一足飛びに運ぶと、途中の動きを見ている相手が掴んだと気づかない。
    'var STEPS = 12;',
    'var se = Application("System Events");',
    'var wasFront = se.processes.whose({ frontmost: true })[0].name();',
    `Application(${name}).activate();`,
    'for (var i = 0; i < 25; i++) {',
    `  if (se.processes.whose({ frontmost: true })[0].name() === ${name}) break;`,
    '  delay(0.02);',
    '}',
    'function at(kind, x, y) {',
    '  $.CGEventPost(0, $.CGEventCreateMouseEvent($(), kind, { x: x, y: y }, 0));',
    '}',
    `at(MOVED, ${String(x1)}, ${String(y1)});`,
    'delay(0.05);',
    `at(LEFT_DOWN, ${String(x1)}, ${String(y1)});`,
    'delay(0.08);',
    'for (var s = 1; s <= STEPS; s++) {',
    `  at(LEFT_DRAGGED, ${String(x1)} + (${String(x2 - x1)} * s) / STEPS, ${String(y1)} + (${String(y2 - y1)} * s) / STEPS);`,
    '  delay(0.02);',
    '}',
    'delay(0.08);',
    `at(LEFT_UP, ${String(x2)}, ${String(y2)});`,
    `if (wasFront !== ${name}) { se.processes.byName(wasFront).frontmost = true; }`,
    '"ok";',
  ].join('\n');
}
