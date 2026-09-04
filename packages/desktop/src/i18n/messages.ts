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

  'key.verified': '合格にする（自分の目で見て確かめた）',
  'key.fail': '不合格にする（自分の目で見て確かめた）',
  'key.blocked': '判断できない（人が見ても決められない）',
  'key.skip': 'このケースは今回見ない',
  'key.advance': '判定を置かずに次のケースへ',
  'key.verified.note': '証跡には VERIFIED として残る',
  'key.fail.note': '証跡には FAIL として残る',
  'key.blocked.note': '証跡には BLOCKED として残る',
  'key.skip.note': '証跡には SKIP として残る',
  'key.advance.note': 'AI の判定のまま（AUTO_PASS）残る',

  'verdict.ai': 'AI の判定: {result}',
  'verdict.revise': '置き直し（このケースは済んでいる。置いても次へは進まない）',
  'key.prev': '前のケースを見る',
  'key.next': '次のケースを見る',
  'key.move.note': '見るだけ。判定は動かない',
  'verdict.running': 'AI が操作している。判定はまだ置けない',
  'verdict.finished': 'この実行は終わった',
  'setup.operator.rule':
    '英数字とハイフンだけ（先頭は英数字・39 文字まで）。証跡に残る名前なので、日本語は使えない',
  'verdict.saved': '証跡を書いた:',
  'verdict.saveFailed': '証跡を書けなかった:',

  'typing.placeholder': '端末に文字を打ち込む（英数字のみ。日本語は送れない）',
  'typing.send': '送る',
  'typing.notAscii': '端末の入力は IME を通らないので、日本語は送れない（英数字だけ送れる）',

  'sheet.none': '走らせている検証シートがない（実行を始めると開けるようになる）',
  'sheet.openFailed': '検証シートを開けない: {message}',

  'live.unsupported': 'この webview は H.264 の復号に対応していない',
  'live.error': 'ライブ映像を出せない: {message}',

  'setup.title': '検証の準備',
  'setup.operator': '0. あなたのハンドル（証跡に「誰が見たか」として残る）',
  'setup.operator.placeholder': '個人名ではなくハンドル（例: octocat）',
  'setup.device': '1. 端末を選ぶ',
  'setup.device.none': '端末が見えていない。USB で繋ぐか、エミュレータを起動する',
  'setup.sheet': '2. 検証シートを選ぶ',
  'setup.sheet.none': '検証シート（TSV）が見つからない。下の「別の場所から選ぶ…」で選ぶ',
  'setup.pick': '別の場所から選ぶ…',
  'setup.start': '検証を開始する',
  'setup.starting': '準備しています…',
  'setup.blocked.operator.empty': 'ハンドルを入れると始められる（0 の欄）',
  'setup.blocked.operator.bad':
    'ハンドルが規則に合っていないので始められない（0 の欄。英数字とハイフンだけ）',
  'setup.blocked.device': '端末が見えていないので始められない（1 の欄）',
  'setup.blocked.sheet': '検証シートが選べていないので始められない（2 の欄）',
  'setup.failed': '始められなかった: {message}',

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

  'key.verified': 'Pass — I watched it myself',
  'key.fail': 'Fail — I watched it myself',
  'key.blocked': 'Cannot judge, even as a person',
  'key.skip': 'Skip this case for now',
  'key.advance': 'Move on without placing a verdict',
  'key.verified.note': 'Recorded as VERIFIED',
  'key.fail.note': 'Recorded as FAIL',
  'key.blocked.note': 'Recorded as BLOCKED',
  'key.skip.note': 'Recorded as SKIP',
  'key.advance.note': "Stays as the AI's own result (AUTO_PASS)",

  'verdict.ai': 'AI verdict: {result}',
  'verdict.revise': 'Re-placing a verdict (this case is done; it will not move on)',
  'key.prev': 'Look at the previous case',
  'key.next': 'Look at the next case',
  'key.move.note': 'Only moves what you are looking at',
  'verdict.running': 'The AI is operating the device. No verdict can be placed yet',
  'verdict.finished': 'This run has finished',
  'setup.operator.rule':
    'Letters, digits and hyphens only (must start with a letter or digit, up to 39 characters).',
  'verdict.saved': 'Evidence written to:',
  'verdict.saveFailed': 'Could not write evidence:',

  'typing.placeholder': 'Type into the device (ASCII only; Japanese cannot be sent)',
  'typing.send': 'Send',
  'typing.notAscii':
    "The device's input does not go through an IME, so Japanese cannot be sent (ASCII only)",

  'sheet.none': 'No test sheet is running yet (start a run and this opens it)',
  'sheet.openFailed': 'Cannot open the test sheet: {message}',

  'live.unsupported': 'This webview cannot decode H.264',
  'live.error': 'Cannot show the live view: {message}',

  'setup.title': 'Before you start',
  'setup.operator': '0. Your handle (recorded as who verified)',
  'setup.operator.placeholder': 'A handle, not a personal name (e.g. octocat)',
  'setup.device': '1. Pick a device',
  'setup.device.none': 'No device is visible. Plug one in over USB, or start an emulator',
  'setup.sheet': '2. Pick a test sheet',
  'setup.sheet.none': 'No test sheet (TSV) was found',
  'setup.pick': 'Choose another file…',
  'setup.start': 'Start verifying',
  'setup.starting': 'Getting ready…',
  'setup.blocked.operator.empty': 'Enter your handle to start (field 0)',
  'setup.blocked.operator.bad':
    'That handle does not match the rule, so this cannot start (field 0: letters, digits and hyphens only)',
  'setup.blocked.device': 'No device is visible, so this cannot start (field 1)',
  'setup.blocked.sheet': 'No test sheet is selected, so this cannot start (field 2)',
  'setup.failed': 'Could not start: {message}',

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
