/**
 * 相手が走行中に変わったかを測る（外部レビュー meta-taro/git-qa#3）。
 *
 * デスクトップアプリなら、**窓の持ち主の実行ファイル**を見る。
 * 大きさと更新時刻が変われば、別のビルドになっている。
 *
 * **完全ではない。**中身だけ差し替わるホットリロード（Electron の renderer など）は、
 * 実行ファイルを変えない。だからこれは「**変わったら分かる**」であって、
 * 「変わっていないことの保証」ではない。
 *
 * そこを取り違えないよう、ここが返すのは**指紋の文字列だけ**にしてある。
 * 「同じ」と言うかどうかは `compareFingerprint`（core）が決める。
 *
 * ---
 *
 * **`ps` を使う。**最初は JXA で `NSRunningApplication` を呼んでいたが、
 * **あれは Foundation ではなく AppKit** で、実物では毎回 `TypeError` を返していた
 * （2026-09-11・実測）。呼び側が失敗を `undefined` に畳んでいたので、
 * **証跡には「測る口を持っていない」と出ていた。**口はあったのに。
 *
 * `ps` に替えたのは、直せたからだけではない。**`osascript` は 1 回 250 ms** かかり、
 * ここは 1 件ごとに呼ぶ。`ps` はその 1/10 以下で、しかも**外部の言語を経由しない。**
 */

export interface ToolCall {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * 窓の持ち主の実行ファイルの場所を聞く。**プロセス番号は数で閉じる。**
 *
 * `-d txt` は「そのプロセスが実行している本体」。**最初の 1 本がそれ。**
 */
export function exePathArgs(pid: number): ToolCall {
  return {
    command: '/usr/sbin/lsof',
    args: ['-p', String(Math.round(pid)), '-a', '-d', 'txt', '-Fn'],
  };
}

/**
 * `lsof -Fn` の答えから場所を取る。**`n` で始まる最初の行**が実行ファイル。
 *
 * **空なら「居ない」**（測れなかったこととして扱う）。
 */
export function parseExePath(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('n')) continue;
    const path = line.slice(1).trim();
    if (path !== '') return path;
  }
  return undefined;
}

/** 指紋 1 本。**同じものは同じ文字列**になる（でないと毎回「変わった」と言うことになる）。 */
export function fingerprintOf(path: string, size: number, modifiedAt: Date): string {
  return `${path}\t${String(size)}\t${modifiedAt.toISOString()}`;
}
