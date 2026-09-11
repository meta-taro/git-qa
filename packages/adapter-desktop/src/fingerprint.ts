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
 */

/** 窓の持ち主の実行ファイルの場所を聞く JXA。**プロセス番号を埋め込まない**（数で閉じる）。 */
export function exePathScript(pid: number): string {
  return [
    'ObjC.import("Foundation");',
    `var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${String(Math.round(pid))});`,
    'app && app.executableURL ? ObjC.unwrap(app.executableURL.path) : "missing value";',
  ].join('\n');
}

/** 指紋 1 本。**同じものは同じ文字列**になる（でないと毎回「変わった」と言うことになる）。 */
export function fingerprintOf(path: string, size: number, modifiedAt: Date): string {
  return `${path}\t${String(size)}\t${modifiedAt.toISOString()}`;
}
