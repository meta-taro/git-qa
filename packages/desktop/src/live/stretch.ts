import { MAIN_COLUMN_ID } from '../columns.js';
import { t } from '../i18n/current.js';

/**
 * **引き伸ばしていることを、画面が言う**（外部レビュー meta-taro/git-qa#17）。
 *
 * > 1:1 を超えたら、そう言う。「ここから先は引き伸ばしなので、細部は増えません」と
 * > 画面が言えると、人は無駄に押さずに済みます。
 * > **いまは押せてしまうので「効かない道具」に見えます。**
 *
 * **足りているうちは黙る。**いつも出ていると読まなくなる
 * （「ずっと出ていると、ちゃんと見れない」——要望シート No.1 と同じ話）。
 */
export function showStretchNote(root: HTMLElement, ratio: number | undefined): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) return;

  const existing = column.querySelector<HTMLElement>('.live-stretched');
  // **測れない・足りている**なら黙る。当てずっぽうの数は出さない。
  if (ratio === undefined || ratio <= 1) {
    existing?.remove();
    return;
  }

  const said = t('live.stretched', { ratio: ratio.toFixed(1) });
  if (existing !== null) {
    existing.textContent = said;
    return;
  }

  const note = root.ownerDocument.createElement('p');
  note.className = 'live-stretched';
  note.textContent = said;
  // 映像の下に置く（映像の上に重ねない —— 見たい所を覆わない）。
  column.append(note);
}
