/**
 * どちらの OS で見るかを決める（2026-09-12）。
 *
 * macOS と Windows は**別のソース**にしてある（2026-09-07 の人の指定）。
 * 窓の探し方も文字の読み方も押し方も考え方が違い、1 本にまとめると
 * **どちらの都合でもない分岐**が増える。
 *
 * **持っていない OS では、持っていないと言う。**黙って空の画面を出さない ——
 * 「映らない」と「そもそも見られない」は、人にとってまるで別のこと。
 */

/** デスクトップ検証ができない理由。**できるなら `undefined`。** */
export function whyNoDesktop(platform: string, toolPath: string | undefined): string | undefined {
  if (platform === 'darwin') return undefined;

  if (platform === 'win32') {
    if (toolPath !== undefined) return undefined;
    return (
      'Windows で窓を見る道具（git-qa-win）が見つからない。' +
      '配布物に入っているはずのものなので、入れ直すか、開発なら `pnpm --filter @git-qa/desktop bundle:win` を走らせてください'
    );
  }

  return `デスクトップアプリの検証は macOS と Windows だけ（いまは ${platform}）。ウェブと Android は見られます`;
}
