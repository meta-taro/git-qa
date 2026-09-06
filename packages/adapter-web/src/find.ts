/**
 * 画面の文字から、触る場所を決める（Issue 015）。
 *
 * 実物の検証シートは「**「保存」をクリックする**」と書く。座標では書かない。
 * 2026-09-06、見本のシートが 3 件目でここに当たって止まった。
 *
 * **見えているものだけを見る。**`display: none` の要素を押すと、何も起きないのに
 * 「押した」ことになる。検証の道具でいちばん高くつくのは、偽の合格。
 */

/**
 * ページの中で走らせる文を組み立てる。
 *
 * **探す文字をそのまま埋め込まない**（product-baseline §21）。閉じられると、
 * その先がページの中で走る別の命令になる。`JSON.stringify` で閉じる。
 *
 * 探し方の順番。**先に当たったものを使う。**
 * 1. 名乗り（`aria-label` / `placeholder` / `value` / `title`）が完全に一致
 * 2. 読める文字が完全に一致
 * 3. 読める文字に含まれる（**いちばん内側**の要素。親を押すと別の所が反応する）
 */
export function findElementScript(ref: string): string {
  const want = JSON.stringify(ref);
  return `(() => {
  const want = ${want};
  const seen = [];
  for (const el of document.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    // 見えているものだけ。隠れた要素を押すと、何も起きないのに押したことになる。
    if (box.width <= 0 || box.height <= 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;

    const labels = [
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('title'),
      el.value,
    ].filter((v) => typeof v === 'string' && v.trim() !== '');
    const text = (el.innerText || el.textContent || '').trim();
    const children = el.children.length;
    seen.push({ el, box, labels: labels.map((v) => v.trim()), text, children });
  }

  /**
   * 触る前に、見える所へ運ぶ。
   *
   * **画面の外にあるものは押せない。**データが増えて下へ流れた要素は、
   * 位置は返るのに、その座標を押しても何も起きない（画面の外なので）。
   * 運んでから測り直す。
   */
  const point = (hit) => {
    if (!hit) return null;
    hit.el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = hit.el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  // 1. 名乗りが完全に一致
  const byLabel = seen.find((h) => h.labels.includes(want));
  if (byLabel) return point(byLabel);

  // 2. 読める文字が完全に一致。**いちばん内側**を選ぶ（親を押すと別の所が反応する）。
  const exact = seen.filter((h) => h.text === want).sort((a, b) => a.children - b.children);
  if (exact.length > 0) return point(exact[0]);

  // 3. 含まれる。ここでも内側を優先し、面積の小さいものを選ぶ。
  const partial = seen
    .filter((h) => h.text.includes(want))
    .sort((a, b) => a.children - b.children || a.box.width * a.box.height - b.box.width * b.box.height);
  return point(partial[0]);
})()`;
}

export interface FoundPoint {
  readonly x: number;
  readonly y: number;
}

/** 返ってきた位置を読む。**当て推量で触らない**ので、読めなければ undefined。 */
export function parseFoundPoint(value: unknown): FoundPoint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const point = value as { x?: unknown; y?: unknown };
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
