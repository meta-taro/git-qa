import { COLUMNS } from './columns.js';
import type { Column } from './columns.js';

/**
 * カラムの区切りを、マウスで動かせるようにする（Issue 012）。
 *
 * **中央が主媒体**（C4）だが、**どれだけ広く見たいかは、見る人と端末による。**
 * 縦長の端末を見るときと、ケース一覧を見比べるときで要る幅が違う。
 *
 * 幅の数値は CSS に書かない（C28）。`--column-flex` を書き換える。
 */

export interface NextFlexParams {
  readonly leftFlex: number;
  readonly rightFlex: number;
  /** 動かした量。右が正。 */
  readonly deltaPx: number;
  /** 換算に使う幅。**測れない（0）なら動かさない。** */
  readonly containerPx: number;
  /** これより小さくしない。0 まで詰められると、カラムが消えて戻せなくなる。 */
  readonly minFlex: number;
  /** 画面全体の取り分の合計。既定は左右 2 つぶん（この 2 つで割り切る場合）。 */
  readonly totalFlex?: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** 端数を丸める。桁を残すと、同じ位置に戻したつもりで戻らない。 */
const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * 動かした px から、左右の取り分を出す。**合計は変えない。**
 * 片方が増えたら隣が同じだけ減る。
 */
export function nextFlex(params: NextFlexParams): { left: number; right: number } {
  const pair = params.leftFlex + params.rightFlex;
  if (params.containerPx <= 0) {
    // 幅が測れない場面（描く前・隠れている）で、当てずっぽうに動かさない。
    return { left: params.leftFlex, right: params.rightFlex };
  }

  const flexPerPx = (params.totalFlex ?? pair) / params.containerPx;
  const left = clamp(
    params.leftFlex + params.deltaPx * flexPerPx,
    params.minFlex,
    pair - params.minFlex,
  );
  return { left: round(left), right: round(pair - left) };
}

export interface InstallColumnResizersOptions {
  /** 既定へ戻すときの拠り所。 */
  readonly columns?: readonly Column[];
  readonly minFlex?: number;
  /** 幅の測り方。**happy-dom では実寸が取れない**ので差し替えられる形にする。 */
  readonly containerWidth?: () => number;
}

const flexOf = (section: HTMLElement, fallback: number): number => {
  const raw = Number(section.style.getPropertyValue('--column-flex'));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const setFlex = (section: HTMLElement, value: number): void => {
  section.style.setProperty('--column-flex', String(value));
};

/**
 * 区切りを差し込み、掴めるようにする。戻り値を呼ぶと外れる。
 *
 * **`renderColumns` の後に呼ぶこと。**あちらは中身を作り直すので、先に入れても消える。
 */
export function installColumnResizers(
  root: HTMLElement,
  options: InstallColumnResizersOptions = {},
): () => void {
  const columns = options.columns ?? COLUMNS;
  const minFlex = options.minFlex ?? 0.2;
  const width = options.containerWidth ?? ((): number => root.getBoundingClientRect().width);

  const sections = [...root.querySelectorAll<HTMLElement>('.column')];
  const totalFlex = columns.reduce((sum, column) => sum + column.flex, 0);

  const handles: HTMLElement[] = [];
  let dragging:
    | { left: HTMLElement; right: HTMLElement; startX: number; leftFlex: number; rightFlex: number }
    | undefined;

  const onMove = (event: MouseEvent): void => {
    if (dragging === undefined) return;
    const next = nextFlex({
      leftFlex: dragging.leftFlex,
      rightFlex: dragging.rightFlex,
      deltaPx: event.clientX - dragging.startX,
      containerPx: width(),
      minFlex,
      totalFlex,
    });
    setFlex(dragging.left, next.left);
    setFlex(dragging.right, next.right);
  };

  const onUp = (): void => {
    dragging = undefined;
  };

  const reset = (): void => {
    for (const [index, section] of sections.entries()) {
      const column = columns[index];
      if (column !== undefined) setFlex(section, column.flex);
    }
  };

  for (const [index, right] of sections.slice(1).entries()) {
    const left = sections[index];
    if (left === undefined) continue;

    const handle = root.ownerDocument.createElement('div');
    handle.className = 'column-resizer';
    // 掴めるものであることを、見た目以外でも伝える。
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');

    handle.addEventListener('mousedown', (event: MouseEvent) => {
      dragging = {
        left,
        right,
        startX: event.clientX,
        leftFlex: flexOf(left, columns[index]?.flex ?? 1),
        rightFlex: flexOf(right, columns[index + 1]?.flex ?? 1),
      };
      // 掴んでいる間に文字が選択されると、掴んだ感触が壊れる。
      event.preventDefault();
    });
    handle.addEventListener('dblclick', reset);

    right.before(handle);
    handles.push(handle);
  }

  const doc = root.ownerDocument;
  doc.addEventListener('mousemove', onMove);
  doc.addEventListener('mouseup', onUp);

  return () => {
    doc.removeEventListener('mousemove', onMove);
    doc.removeEventListener('mouseup', onUp);
    for (const handle of handles) handle.remove();
  };
}
