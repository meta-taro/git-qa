/**
 * 画面の文言。**ここが正本で、画面のコードに文字列を書かない。**
 *
 * 書くと、後から言語を足すときに「どこにあるか分からない」状態になる。
 * 鍵の集合が言語間でずれていないことは、テストで見ている（訳し漏れの検出）。
 *
 * **色や字面は決めない**（`DESIGN.md` が空・product-baseline §11）。ここにあるのは文言だけ。
 */

const ja = {
  'column.cases.heading': 'ケース',
  'column.cases.placeholder': '検証シートを読み込むと、ここにケースが並ぶ',
  'column.live.heading': 'ライブビュー',
  'column.live.placeholder': '接続すると、ここに検証中の画面が出る',
  'column.verdict.heading': '判定',
  'column.verdict.placeholder': '実行を始めると、ここに判定と証跡が出る',

  'key.verified': 'VERIFIED（見た。合格）',
  'key.fail': 'FAIL（見た。不合格）',
  'key.blocked': 'BLOCKED（人にも判断できない）',
  'key.skip': 'SKIP（今回は見ない）',
  'key.advance': '置かずに次へ（AUTO_PASS のまま）',

  'verdict.ai': 'AI の判定: {result}',
  'verdict.running': 'AI が操作している。判定はまだ置けない',
  'verdict.finished': 'この実行は終わった',

  'live.unsupported': 'この webview は H.264 の復号に対応していない',
  'live.error': 'ライブ映像を出せない: {message}',

  'onboarding.title': 'はじめかた',
  'onboarding.lead': 'この 3 つが済むと、検証中の端末の画面がここに出る',
  'onboarding.current': 'いまここ',
  'onboarding.step.device.title': '1. 端末を繋ぐ',
  'onboarding.step.device.detail':
    'Android 端末を USB で繋ぐか、エミュレータを起動する。繋がっていれば、端末の名前が出る',
  'onboarding.step.sheet.title': '2. 検証シートを用意する',
  'onboarding.step.sheet.detail':
    '手順と期待結果が書かれた TSV。同梱の見本を使う場合は packages/core/test/fixtures/sample-notes-app.tsv',
  'onboarding.step.run.title': '3. 実行を始める',
  'onboarding.step.run.detail':
    '端末に繋ぎ、この画面に映像を出し、1 件目から順に走らせる。判定は 1 打鍵で置く',
  'onboarding.terminal': 'いまはターミナルから始める。この画面から始められるようにする作業は途中',

  'menu.app': 'git-qa',
  'menu.app.quit': 'git-qa を終了',
  'menu.edit': '編集',
  'menu.edit.copy': 'コピー',
  'menu.edit.paste': '貼り付け',
  'menu.edit.selectAll': 'すべて選択',
  'menu.view': '表示',
  'menu.view.reload': '再読み込み',
  'menu.window': 'ウインドウ',
  'menu.window.minimize': 'しまう',
  'menu.window.close': '閉じる',
} as const;

const en: Record<keyof typeof ja, string> = {
  'column.cases.heading': 'Cases',
  'column.cases.placeholder': 'Load a test sheet and the cases will be listed here',
  'column.live.heading': 'Live view',
  'column.live.placeholder': 'Connect a device and its screen will appear here',
  'column.verdict.heading': 'Verdict',
  'column.verdict.placeholder': 'Start a run and the verdict and evidence will appear here',

  'key.verified': 'VERIFIED (watched, passed)',
  'key.fail': 'FAIL (watched, failed)',
  'key.blocked': 'BLOCKED (a person cannot judge either)',
  'key.skip': 'SKIP (not looking this time)',
  'key.advance': 'Move on without placing (stays AUTO_PASS)',

  'verdict.ai': 'AI verdict: {result}',
  'verdict.running': 'The AI is operating the device. No verdict can be placed yet',
  'verdict.finished': 'This run has finished',

  'live.unsupported': 'This webview cannot decode H.264',
  'live.error': 'Cannot show the live view: {message}',

  'onboarding.title': 'Getting started',
  'onboarding.lead': 'Once these three are done, the device screen appears here',
  'onboarding.current': 'you are here',
  'onboarding.step.device.title': '1. Connect a device',
  'onboarding.step.device.detail':
    'Plug in an Android device over USB, or start an emulator. If it is connected, its name is listed',
  'onboarding.step.sheet.title': '2. Prepare a test sheet',
  'onboarding.step.sheet.detail':
    'A TSV with steps and expected results. To use the bundled sample: packages/core/test/fixtures/sample-notes-app.tsv',
  'onboarding.step.run.title': '3. Start the run',
  'onboarding.step.run.detail':
    'Connects the device, shows its screen here, and runs the cases in order. Verdicts are one keystroke',
  'onboarding.terminal':
    'For now a run starts from the terminal. Starting it from this screen is still being built',

  'menu.app': 'git-qa',
  'menu.app.quit': 'Quit git-qa',
  'menu.edit': 'Edit',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.selectAll': 'Select All',
  'menu.view': 'View',
  'menu.view.reload': 'Reload',
  'menu.window': 'Window',
  'menu.window.minimize': 'Minimize',
  'menu.window.close': 'Close',
};

export type MessageKey = keyof typeof ja;

export const MESSAGES = { ja, en } as const;
