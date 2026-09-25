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
 * 4. **名乗りに含まれる**（外部レビュー meta-taro/git-qa#28）。画面に文字が出ていない部品は
 *    名乗りでしか指せず、その名乗りは合成された 1 本（`2026-09-20 定休日`）のことが多い
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

    /**
     * **押せるものかどうか**（外部レビュー meta-taro/git-qa#41）。
     *
     * 同じ文字が**カードの見出し**（押せない）と**送信ボタン**（押せる）の
     * 2 箇所にある画面で、**見出しに当たっていた。**
     * 押しても何も起きないのに、**手順は成功として記録されていた。**
     *
     * シートに「「保存」をクリックする」と書く人は、**押せるものを指している。**
     */
    const role = (el.getAttribute('role') || '').toLowerCase();
    const tag = el.tagName.toLowerCase();
    const pressable =
      tag === 'button' ||
      tag === 'summary' ||
      (tag === 'a' && el.hasAttribute('href')) ||
      (tag === 'input' && ['submit', 'button', 'reset', 'checkbox', 'radio'].includes(el.type)) ||
      tag === 'select' ||
      tag === 'textarea' ||
      (tag === 'input') ||
      role === 'button' ||
      role === 'link' ||
      role === 'tab' ||
      role === 'menuitem' ||
      role === 'option' ||
      role === 'checkbox' ||
      role === 'radio' ||
      typeof el.onclick === 'function' ||
      el.hasAttribute('onclick');

    /**
     * **押せない状態のもの**（#41 の提案 2）。
     *
     * **押していないのに手順が成功として残る**のが、この道具がいちばんやってはいけない形。
     * 候補から外し、**そればかりだったときは、そう言って止める。**
     */
    const blocked =
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      style.pointerEvents === 'none';

    seen.push({ el, box, labels: labels.map((v) => v.trim()), text, children, pressable, blocked });
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
    // **大きさも返す**（2026-09-24）。枠で囲むのに要る —— 中心だけでは描けない。
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      width: box.width,
      height: box.height,
    };
  };

  /**
   * **押せるものを先に**（#41）。
   *
   * 「いちばん内側」は**入れ子の話**で、**押せるかどうかの前に置くものではなかった。**
   * 見出しもボタンも子を持たなければ children は同じ 0 なので、
   * **文書に先に出てくるほう（見出し）が勝っていた。**
   *
   * **押せない状態のものは、この時点で外す**（候補にしない）。
   */
  const inner = (a, b) => a.children - b.children;
  const smaller = (a, b) => a.box.width * a.box.height - b.box.width * b.box.height;
  // 同じ種類の候補どうしの順位。内側・小さいほう（#28 で決めたこと）。
  const ranked = (list) => list.slice().sort((a, b) => inner(a, b) || smaller(a, b));

  /**
   * 段ごとの選び方（2026-09-24 に実物で踏んで作り直した）。
   *
   * 1. 押せる ＆ 塞がっていない  → 押す
   * 2. 押せる ＆ 塞がっている    → 押さない。**塞がっていると言う**
   * 3. 押せない ＆ 塞がっていない → 押す（文字しか無い相手はここ）
   *
   * **2 で 3 へ落ちてはいけない。**落ちると、**ボタンが disabled のときに見出しを押して
   * 「成功」にする** —— #41 が言っている形を、直した側で作ることになる。
   */
  const pick = (list) => {
    const openPress = ranked(list.filter((h) => h.pressable && !h.blocked));
    if (openPress.length > 0) return point(openPress[0]);
    if (list.some((h) => h.pressable && h.blocked)) return { disabledOnly: true };
    const plain = ranked(list.filter((h) => !h.blocked));
    return plain.length > 0 ? point(plain[0]) : null;
  };

  // 1. 名乗りが完全に一致
  const byLabel = pick(seen.filter((h) => h.labels.includes(want)));
  if (byLabel) return byLabel;

  // 2. 読める文字が完全に一致
  const exact = pick(seen.filter((h) => h.text === want));
  if (exact) return exact;

  // 3. 含まれる
  const partial = pick(seen.filter((h) => h.text.includes(want)));
  if (partial) return partial;

  /**
   * 4. 名乗りに含まれる（外部レビュー meta-taro/git-qa#28）。
   *
   * **画面に文字が出ていない部品は、名乗りでしか指せない。**そしてその名乗りは
   * たいてい合成された 1 本（例: 2026-09-20 定休日）なので、**完全一致では当たらない。**
   * 並べ方は 3 段目と同じ（内側・小さいほう）。
   */
  const byLabelPartial = pick(seen.filter((h) => h.labels.some((v) => v.includes(want))));
  if (byLabelPartial) return byLabelPartial;

  return null;
})()`;
}

/**
 * **押せる名前を並べる**（2026-09-19・MCP 拡充）。
 *
 * `element_tap` は名前で押せるのに、**どんな名前が在るかを知る口が無かった。**
 * AI は画面の文字を読んで推し量るしかなく、外れると `missingElementMessage` で止まる。
 *
 * **契約は 1 つ。ここに並んだものは、そのまま `element_tap` に渡せる。**
 * だから `findElementScript` と**同じ集め方**にしてある（見えているものだけ）。
 *
 * **上限を持つ。**画面 1 枚で数千返すと、AI が読めないうえに文脈を食う。
 */
export function listElementsScript(limit = 120): string {
  return `(() => {
  const names = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const said = v.trim();
    // **長すぎるものは名前として使えない**（そのまま渡しても一致しない）。
    if (said === '' || said.length > 60) return;
    if (!names.includes(said)) names.push(said);
  };

  for (const el of document.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    // 見えているものだけ。隠れた要素を押すと、何も起きないのに押したことになる。
    if (box.width <= 0 || box.height <= 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;

    // 名乗り（探すときの 1 段目・4 段目）。
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('placeholder'));
    push(el.getAttribute('title'));
    push(el.value);

    /**
     * 読める文字（探すときの 2 段目）。**いちばん内側だけ**を並べる ——
     * 親の文字は子の文字を全部含むので、そのまま入れると同じ名前が何段も出る。
     */
    if (el.children.length === 0) push(el.innerText || el.textContent);
  }
  return names.slice(0, ${String(limit)});
})()`;
}

/**
 * 返ってきた名前を読む。**当て推量で押させない**ので、文字でないものは落とす。
 *
 * **「無い」と「読めない」を混ぜないのは呼ぶ側**（ここは空を返すだけ）。
 */
export function parseElementNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const said of value) {
    if (typeof said !== 'string') continue;
    const name = said.trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface FoundPoint {
  readonly x: number;
  readonly y: number;
  /** 見つけたものの大きさ。**枠で囲むのに要る。**古い返りには無い。 */
  readonly width?: number;
  readonly height?: number;
}

/** 返ってきた位置を読む。**当て推量で触らない**ので、読めなければ undefined。 */
export function parseFoundPoint(value: unknown): FoundPoint | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const point = value as { x?: unknown; y?: unknown };
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;

  const size = value as { width?: unknown; height?: unknown };
  const box =
    typeof size.width === 'number' &&
    typeof size.height === 'number' &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height)
      ? { width: Math.round(size.width), height: Math.round(size.height) }
      : {};
  return { x: Math.round(point.x), y: Math.round(point.y), ...box };
}

/**
 * 見つからなかったときの言い分（外部レビュー meta-taro/git-qa#28）。
 *
 * > 落ちたログからは「そんな要素は無い」としか読めない。**実物には在る。**
 *
 * **探した所を言えば、次に見る場所が決まる。**
 * 画面に出ていない部品は名乗り（`aria-label` 等）にしか無いので、
 * **そこも探したうえで無かった**のか、**書き方が違う**のかを、人が切り分けられる。
 */
/**
 * **見つかったが、押せない状態だった**（外部レビュー meta-taro/git-qa#41）。
 *
 * **「見つからない」と混ぜない。**混ぜると、
 * **シートの書き方が悪いのか、画面がその状態なのか**が分からない。
 */
export function foundDisabledOnly(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { disabledOnly?: unknown }).disabledOnly === true;
}

/** 押せない状態のものしか無かったときの言い分。**次に何をすればよいかまで言う。** */
export function disabledElementMessage(ref: string): string {
  return (
    `${JSON.stringify(ref)} は在るが、押せない状態だった` +
    '（disabled / aria-disabled / pointer-events: none）。' +
    '**押したことにしない。**その画面でそれが押せるようになる条件を、手順の前に置く'
  );
}

export function missingElementMessage(ref: string): string {
  return (
    `画面に見つからない要素: ${JSON.stringify(ref)}` +
    '（読める文字は完全一致と部分一致、名乗り（aria-label / placeholder / title / value）も' +
    '完全一致と部分一致で探した。見えていない要素は探していない）'
  );
}

/**
 * **ブラウザの見える大きさ**（CSS 画素・2026-09-25・人が実物で見つけた）。
 *
 * > デスクトップアプリ、うぇbのブラウザサイズとかも。
 *
 * 実行側はこれを 2 つに使う。
 *
 * 1. **赤い枠と矢印を置く**ための、映像の中の座標の数え方（`run-session` の `pointing`）
 * 2. **人が映像を押した所**を、ブラウザへ渡す CSS 画素へ戻す
 *
 * **持ち回さない。**窓の大きさは走っている間に変わるので、聞かれるたびに聞き直す。
 */
export function viewportScript(): string {
  return '({ width: window.innerWidth, height: window.innerHeight })';
}

/**
 * 返りを数に直す。**測れなければ `undefined`** ——
 * 当て推量の大きさを返すと、**見当違いの所を押す。**
 */
export function parseViewport(value: unknown): { width: number; height: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const size = value as { width?: unknown; height?: unknown };
  if (typeof size.width !== 'number' || typeof size.height !== 'number') return undefined;
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return undefined;
  if (size.width <= 0 || size.height <= 0) return undefined;
  return { width: Math.round(size.width), height: Math.round(size.height) };
}
