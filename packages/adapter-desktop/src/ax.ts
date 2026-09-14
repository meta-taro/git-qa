/**
 * 触れ方の**段 1** —— アクセシビリティ（C55）。
 *
 * 名前で触れるので、シートに「「保存」をクリックする」とそのまま書ける。
 * 実測（2026-09-06）: 窓 1 つで **793 ms**。
 *
 * **段 1 が空でも諦めない。**アプリが自分で画面を描いていると、ここには何も出てこない。
 * その先は絵から文字を読む（`ocr.ts`）。**アプリの作りで線を引かない。**
 */

/**
 * **中身を出してもらう。**
 *
 * Electron / Chromium は、支援技術に聞かれるまで木を作らない。
 * 作っていない間は段 1 が `group` だけになり、押すと `-25211`
 * （補助アクセスは許可されません）が返る。**許可はあるのに、その文言で返る。**
 * 2026-09-07、Electron のアプリでここに嵌まった。
 *
 * この属性を持たないアプリでは失敗する。**呼び側で握り潰す**（下記の理由つき）。
 */
export function manualAccessibilityScript(app: string): string {
  return (
    `tell application "System Events" to tell process ${JSON.stringify(app)} ` +
    'to set value of attribute "AXManualAccessibility" to true'
  );
}

/** 画面に出ている部品 1 つ。位置と大きさは、触る場所を決めるのに要る。 */
export interface AxElement {
  readonly role: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * どこまで潜るか。**深すぎると遅くなる**（実測 793 ms は 4 段のとき）。
 *
 * **6 では WebView のアプリに届かなかった**（外部レビュー meta-taro/git-qa#11）。
 *
 * > 窓 → AXGroup → AXScrollArea → AXWebArea → … と潜るので、
 * > WebView を使うアプリは素の AppKit より 2〜3 段深くなります。
 *
 * 実例では**操作できる部品が全部 深さ 7** に並び、6 で届いていたのは一覧だけだった。
 * **押したいものが軒並み 1 段外**という、いちばん気づきにくい外し方。
 */
const DEFAULT_DEPTH = 9;

/**
 * どこまで潜るか。**環境変数で上げられる。**
 *
 * 9 でも届かないアプリが出たときに、**配り直さずに試せる**ようにしておく。
 * 深くすると遅くなるので、**既定は上げない。**
 */
export function axDepth(env: NodeJS.ProcessEnv = process.env): number {
  const said = Number(env['GIT_QA_AX_DEPTH']);
  return Number.isInteger(said) && said > 0 && said <= 40 ? said : DEFAULT_DEPTH;
}

/**
 * 深さで打ち切ったことの印。
 *
 * **「無い」と「届かなかった」を分ける。**分けないと、読んだ人は
 * 「名前が違うのだろう」と思って別の名前を試す —— 実際にそうなった（#11）。
 *
 * 部品の行はタブ区切りなので、**タブを含まない 1 語**にしてある（混ざらない）。
 */
export const DEPTH_CUT = '<深さで打ち切り>';

/**
 * 見つからなかったことを、人へ伝える。
 *
 * **「無い」と「届かなかった」を分ける**（外部レビュー meta-taro/git-qa#11）。
 * 分けないと、読んだ人は「名前が違うのだろう」と思って別の名前を試す ——
 * **実際にそうなった。**
 */
export function missingElementMessage(
  ref: string,
  cutOff: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const head = `画面に見つからない要素: ${JSON.stringify(ref)}`;
  if (!cutOff) return head;

  return (
    `${head}。ただし**深さ ${String(axDepth(env))} で打ち切っている**ので、` +
    'その先に在るかもしれません。`GIT_QA_AX_DEPTH` を大きくすると、もっと潜ります'
  );
}

/** 深さで打ち切られたか。**印が在れば、見ていない部品がある。** */
export function wasCutOff(stdout: string): boolean {
  return stdout.split('\n').some((line) => line.trim() === DEPTH_CUT);
}

/**
 * 窓の中の部品を並べる JXA。
 *
 * **アプリ名をそのまま埋め込まない**（product-baseline §21）。`JSON.stringify` で閉じる。
 * 読めない部品は飛ばす —— **1 つ読めないだけで一覧ごと落とさない。**
 */
export function axScript(app: string, env: NodeJS.ProcessEnv = process.env): string {
  const maxDepth = axDepth(env);
  return [
    `var want = ${JSON.stringify(app)};`,
    'var se = Application("System Events");',
    'if (!se.processes[want].exists()) { "missing value" } else {',
    '  var win = se.processes[want].windows[0];',
    '  var out = [];',
    '  var cut = false;',
    '  function walk(el, depth) {',
    // **打ち切ったことを言う。**黙って浅く返すと、「無い」と読まれる。
    `    if (depth > ${String(maxDepth)}) { cut = true; return; }`,
    '    var kids;',
    '    try { kids = el.uiElements(); } catch (e) { return; }',
    '    for (var i = 0; i < kids.length; i++) {',
    '      var k = kids[i];',
    '      try {',
    '        var name = k.name() || k.description() || k.value();',
    '        if (typeof name === "string" && name !== "") {',
    '          var p = k.position();',
    '          var s = k.size();',
    '          out.push([k.role(), name, p[0], p[1], s[0], s[1]].join("\\t"));',
    '        }',
    '      } catch (e) { /* 読めない部品は飛ばす。1 つで一覧ごと落とさない */ }',
    '      walk(k, depth + 1);',
    '    }',
    '  }',
    '  try { walk(win, 0); } catch (e) { /* 窓が閉じられた等。取れた分を返す */ }',
    `  if (cut) out.push(${JSON.stringify(DEPTH_CUT)});`,
    '  out.join("\\n");',
    '}',
  ].join('\n');
}

/** 1 行 1 部品として読む。**半端な行は捨てる**（欠けた値で触らない）。 */
export function parseElements(stdout: string): AxElement[] {
  const found: AxElement[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 6) continue;

    const [role, name] = parts as [string, string, string, string, string, string];
    const numbers = parts.slice(2, 6).map(Number);
    if (numbers.some((n) => !Number.isFinite(n))) continue;

    const [x, y, width, height] = numbers as [number, number, number, number];
    // 名前で触るための一覧なので、名前の無いものは持たない。
    if (name.trim() === '') continue;
    // **見えない部品は触らない。**大きさが無いものを押しても何も起きない。
    if (width <= 0 || height <= 0) continue;

    found.push({ role, name: name.trim(), x, y, width, height });
  }
  return found;
}

export interface Point {
  readonly x: number;
  readonly y: number;
  /** 見つけたものの大きさ。**指す矢印を、その外へ置くのに要る。** */
  readonly width?: number;
  readonly height?: number;
}

/** 真ん中と、その大きさ。**大きさは、指す矢印を外へ置くのに要る。** */
const center = (el: AxElement): Point => ({
  x: Math.round(el.x + el.width / 2),
  y: Math.round(el.y + el.height / 2),
  width: el.width,
  height: el.height,
});

/**
 * 名前から触る場所を決める。
 *
 * 完全一致を先に見て、無ければ含むもの。**含むときは小さいほうを選ぶ**
 * —— 大きい親を押すと、別の所が反応する。
 */
export function findInElements(elements: readonly AxElement[], ref: string): Point | undefined {
  const exact = elements.find((el) => el.name === ref);
  if (exact !== undefined) return center(exact);

  const partial = elements
    .filter((el) => el.name.includes(ref))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return partial[0] === undefined ? undefined : center(partial[0]);
}
