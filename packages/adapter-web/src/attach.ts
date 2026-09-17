/**
 * **既に起きているブラウザへ繋ぐ**（meta-taro/git-qa#30）。
 *
 * > Playwright で書いてある手順（ログイン・データ用意・複雑な操作）を使い回せない
 *
 * **操作はそちら、判定はこちら。****Playwright を再実装しない**（PRD の非目標）。
 *
 * **他人のものを片付けない。**自分で起こしていないブラウザを閉じるのは、
 * #20（置き去りを 30 個溜めた）の**逆側の間違い** —— 人が使っているものを勝手に落とす。
 */

/**
 * 人が渡す繋ぎ先を、CDP の口へ直す。
 *
 * **人は `http://127.0.0.1:9222` を渡す**（ブラウザが案内する形）。
 * `ws://` をそのまま渡されても受ける。**読めないものは受け取らない。**
 */
export function devToolsUrlFrom(given: string): string | undefined {
  const said = given.trim().replace(/\/+$/, '');
  if (said.startsWith('ws://') || said.startsWith('wss://')) return said;
  if (said.startsWith('http://')) return `ws://${said.slice('http://'.length)}`;
  if (said.startsWith('https://')) return `wss://${said.slice('https://'.length)}`;
  return undefined;
}

/** 自分で起こしたものだけ閉じる。**繋いだだけのものは、持ち主が閉じる。** */
export function shouldCloseBrowser(given: string | undefined): boolean {
  return given === undefined;
}

/**
 * 証跡へ残す 1 行。**自分で起こした実行と混ぜない。**
 *
 * 前準備を誰がやったのかで、**同じ結果でも意味が変わる**
 * （繋いだ先は、既にログイン済み・データ投入済みかもしれない）。
 */
export function attachedNote(given: string | undefined): string | undefined {
  if (given === undefined) return undefined;
  return '既に起きていたブラウザに繋いだ（前の操作の続きを見ている可能性がある）';
}
