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
