/**
 * 外の道具が落ちたときの言い分を、**人が次に何をすればよいか**まで含んだ文へ直す。
 *
 * 2026-09-07、連動くん（Electron）で「「管理」を押す」が
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
      '画面を触る許可が無い（アクセシビリティ）。画面を見ることはできているので、',
      '許可が要るのは触る側だけ。',
      'システム設定 → プライバシーとセキュリティ → アクセシビリティ を開き、',
      'git-qa を動かしているターミナル（ターミナル / iTerm など）を足して入にする。',
      '入れたあと、ターミナルを開き直す（開いたままだと古い許可のまま動く）。',
      `もとの言い分: ${said}`,
    ].join('\n');
  }

  return `${command} が失敗した: ${said}`;
}
