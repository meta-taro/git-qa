import { MAIN_COLUMN_ID } from '../columns.js';

/**
 * **触ったのに届かなかった理由を、画面へ出す**（外部レビュー meta-taro/git-qa#33）。
 *
 * > 問題は、それが画面に出ないこと。…「そのまま届きます」と書いてあります。
 * > **届かなかった今回は、この案内と食い違っています。**
 *
 * 理由はターミナルにだけ流れていた。**端末は人の画面ではない。**
 * しかも**「届きます」と書いてある案内の隣で、届いていない** ——
 * 人は「押し方が悪いのか」と自分を疑う。
 *
 * **直ったら消す**（出したままだと、直っているのに直っていないように見える）。
 */
export function showInputError(root: HTMLElement, message: string | undefined): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) return;

  const note = column.querySelector<HTMLElement>('.live-note');
  const existing = column.querySelector<HTMLElement>('.live-input-error');

  if (message === undefined) {
    existing?.remove();
    // **案内を戻す。**届くようになったなら、打ち消したままにしない。
    if (note !== undefined && note !== null) delete note.dataset['stale'];
    return;
  }

  // **案内と食い違わせない**（#33 の提案 3）。届かない間は、その案内を打ち消す。
  if (note !== undefined && note !== null) note.dataset['stale'] = 'true';

  if (existing !== null) {
    existing.textContent = message;
    return;
  }

  const said = root.ownerDocument.createElement('p');
  said.className = 'live-input-error';
  said.textContent = message;
  // 映像のすぐ下（案内の上）。**押した人の目が行く所。**
  if (note !== null) note.before(said);
  else column.append(said);
}
