/**
 * 外の道具が落ちたときの言い分を、**人が次に何をすればよいか**まで含んだ文へ直す。
 *
 * 2026-09-07、Electron で作られたデスクトップアプリで「「管理」を押す」が
 * 「osascript には補助アクセスは許可されません。(-25211)」で止まった。
 * **原因は書いてあるのに、直し方が無い。**しかも「見る」と「触る」で必要な許可が別なので、
 * そこを言わないと画面収録の設定を疑いに行くことになる。
 */

/** macOS が補助アクセス（アクセシビリティ）を断ったときの言い方。日本語と英語の両方で出る。 */
const NO_ASSISTIVE_ACCESS = /-25211|補助アクセス|assistive access/;

export function explainToolFailure(command: string, stderr: string): string {
  const said = stderr.trim();
  if (said === '') return `${command} が失敗した（何も言わずに落ちた）`;

  if (NO_ASSISTIVE_ACCESS.test(said)) {
    return [
      '画面を触れなかった。原因は 2 つあり、言い分だけでは区別が付かない。',
      '',
      '(1) 触る許可（アクセシビリティ）が無い。画面を見ることはできているので、',
      '    足りないのは触る側だけ。システム設定 → プライバシーとセキュリティ →',
      '    アクセシビリティ を開き、git-qa を動かしているターミナルを足して入にする。',
      '    入れたあとターミナルを開き直す（開いたままだと古い許可のまま動く）。',
      '',
      '(2) 相手のアプリが、まだ画面の中身を出していない。許可が入っているのに出ることがある。',
      '    Electron / Chromium で作ったアプリがこれで、聞かれるまで中身を作らない。',
      '    git-qa は繋いだときに出すよう頼んでいるが、断られた場合はここで止まる。',
      '',
      `もとの言い分: ${said}`,
    ].join('\n');
  }

  return `${command} が失敗した: ${said}`;
}

/**
 * **画面収録の許可があるかを macOS に聞く**（meta-taro/git-qa#33・2026-09-30 の報告）。
 *
 * 配布版を入れ替えると、画面収録の許可が外れる。そのとき git-qa は「映像が切れました・繋ぎ直します」を
 * 繰り返すだけで、**許可が無いことが分からなかった。**
 * 聞くのは git-qa から起こした `osascript` なので、答えは git-qa 自身の許可になる。
 */
export const SCREEN_RECORDING_PREFLIGHT =
  'ObjC.import("CoreGraphics"); ' +
  'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]); ' +
  '$.CGPreflightScreenCaptureAccess()';

/** 答えを読む。**読めなければ `undefined`**（分からないときは止めない。止めると、許可があるのに使えなくなる）。 */
export function parseScreenRecordingPreflight(stdout: string): boolean | undefined {
  const said = stdout.trim();
  if (said === 'true') return true;
  if (said === 'false') return false;
  return undefined;
}

/** 許可が無いときに出す文。**無いことと、どこで入れるかと、入れたあと何をするか。** */
export const NO_SCREEN_RECORDING = [
  'この Mac では、git-qa に画面収録の許可が無い（配布版を入れ替えると外れることがある）。',
  'システム設定 → プライバシーとセキュリティ → 画面収録とシステムオーディオ録音 で git-qa を入にし、',
  'git-qa を起動し直す（起動したままだと、古い許可のまま動く）。',
].join('\n');
