/**
 * **枠が変わったことを伝える**（外部レビュー meta-taro/git-qa#15）。
 *
 * > 窓を横に広げたり縮めたりすると、矢印が指していた場所からずれます。
 * > 映像は追従するのに、矢印だけ元の画素位置に残る形です。
 *
 * 矢印は**そのときの枠**から画素位置を出して絶対位置で置くので、枠が変われば置き直しが要る。
 * ところが置き直す唯一の口（`showPointer`）は、**状態が届いたときだけ**通っていた。
 * **判定を待っている間は状態が来ない** —— 待っている間に窓を変えると、ずれたまま残る。
 *
 * **`resize` では足りない。**カラムの区切りを動かしても枠は変わるが、窓の大きさは変わらない。
 * だから**要素そのものの大きさ**を見張る。
 */

/** 見張りを止める。**画面を作り直すときに、前の見張りを残さない。** */
export type StopWatching = () => void;

export function watchSize(
  target: Element,
  onChange: () => void,
  view: Window | null | undefined = target.ownerDocument.defaultView,
): StopWatching {
  if (view === null || view === undefined) return () => undefined;

  const Observer = (view as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (Observer !== undefined) {
    const watcher = new Observer(() => onChange());
    watcher.observe(target);
    return () => watcher.disconnect();
  }

  // **無い器でも、窓の大きさだけは見る。**区切りを動かした分は拾えないが、何も拾えないよりよい。
  const onResize = (): void => onChange();
  view.addEventListener('resize', onResize);
  return () => view.removeEventListener('resize', onResize);
}
