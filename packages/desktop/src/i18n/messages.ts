/**
 * 画面の文言。**ここが正本で、画面のコードに文字列を書かない。**
 *
 * 書くと、後から言語を足すときに「どこにあるか分からない」状態になる。
 * 鍵の集合が言語間でずれていないことは、テストで見ている（訳し漏れの検出）。
 *
 * **色や字面は決めない**（`DESIGN.md` が空・product-baseline §11）。ここにあるのは文言だけ。
 *
 * **書き方**（C51）:
 * 1. 何が起きたかを、**人の言葉で先に**書く（道具の内部名を先頭に置かない）
 * 2. 次に何をすればいいかを書く
 * 3. 技術的な詳細（コマンド名・stderr・serial）は**括弧で後ろに残す。消さない**
 * 4. **見出しと重ねない。**欄の中に出る文は、欄の名前を繰り返さない
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
  'key.move.note': '見る場所が動く。走ったケースなら、戻って置き直せる',
  'verdict.running': 'AI が操作している。判定はまだ置けない',
  'verdict.finished': '検証は終了しました',
  'setup.operator.rule':
    '39 文字まで。空白と / \\ は使えない。個人名ではなく、名乗る名前を入れる（証跡に残る）',
  'flash.verified': '合格',
  'flash.fail': '不合格',
  'flash.blocked': '判断できない',
  'flash.skip': '今回は見ない',
  'flash.autoPass': 'AI の判定のまま（人は見ていない）',

  'verdict.saved': '証跡を書いた:',
  'verdict.saveFailed': '証跡を書けなかった:',

  'typing.placeholder': '端末に文字を打ち込む（英数字のみ。日本語は送れない）',
  'typing.send': '送る',
  'typing.notAscii': '端末の入力は IME を通らないので、日本語は送れない（英数字だけ送れる）',

  'sheet.none': '走らせている検証シートがない（実行を始めると開けるようになる）',
  'sheet.openFailed': '検証シートを開けない: {message}',

  'live.unsupported': 'この webview は H.264 の復号に対応していない',
  // ライブビューの欄の中に出る。**見出しと重ねない。**中身の文が自分で何が起きたかを言う
  'live.error': '{message}',

  'setup.title': '検証の準備',
  'setup.operator': '0. あなたのハンドル（証跡に「誰が見たか」として残る）',
  'setup.operator.placeholder': '個人名ではなく、名乗る名前（例: めたたろ / octocat）',
  'setup.device': '1. 見る相手を選ぶ',
  'setup.web': 'ウェブページを見るなら、URL を入れる（端末より優先）',
  'live.desktop.note':
    'ここから押すのは、そのまま届きます（相手は前に出てきません）。' +
    'なぞる・掴んで運ぶは、指が一瞬そちらへ飛びます。気になるときは実物の窓を直接触ってください。',
  'setup.app': 'デスクトップアプリを見るなら、アプリ名を入れる（窓の持ち主の名前）',
  'setup.app.placeholder': '連絡くん / 計算機 など',
  'setup.web.placeholder': 'http://localhost:3000/ または https://…',
  'setup.browser': '見るブラウザ（証跡に版が残る）',
  'setup.browser.chrome': 'Chrome',
  'setup.browser.edge': 'Edge',
  'setup.browser.brave': 'Brave',
  'setup.browser.opera': 'Opera',
  'setup.browser.vivaldi': 'Vivaldi',
  'setup.browser.firefox': 'Firefox',
  'setup.browser.safari': 'Safari',
  'setup.browser.other': 'その他（場所を指定する）',
  // **名前を数え上げに行かない。**セキュリティソフト付属のブラウザは数えきれないし、増える
  'setup.browser.path': '中身が Chromium なら動く（セキュリティソフト付属のものなど）',
  'setup.browser.path.placeholder': '/Applications/○○.app/Contents/MacOS/○○',
  'setup.device.none': '端末が見えていない。USB で繋ぐか、エミュレータを起動する',
  'setup.sheet': '2. 検証シートを選ぶ',
  'setup.sheet.none': '検証シート（TSV）が見つからない。下の「別の場所から選ぶ…」で選ぶ',
  'setup.pick': '別の場所から選ぶ…',
  'setup.start': '検証を開始する',
  'setup.starting': '準備しています…',
  'setup.blocked.operator.empty': 'ハンドルを入れると始められる（0 の欄）',
  // **規則を読ませるのではなく、目の前の値の何が駄目かを言う。**
  'setup.blocked.operator.bad':
    'ハンドルに空白か区切り（/ \\）が入っているか、39 文字を超えているので始められない（0 の欄）',

  'setup.blocked.device':
    '見る相手が決まっていないので始められない（1 の欄。端末を選ぶか、URL を入れる）',
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
  'key.move.note': 'Moves what you are looking at; you can re-place on cases that ran',
  'verdict.running': 'The AI is operating the device. No verdict can be placed yet',
  'verdict.finished': 'This run has finished.',
  'setup.operator.rule':
    'Letters, digits and hyphens only (must start with a letter or digit, up to 39 characters).',
  'flash.verified': 'Pass',
  'flash.fail': 'Fail',
  'flash.blocked': 'Cannot judge',
  'flash.skip': 'Skipped',
  'flash.autoPass': "The AI's own result (no one watched)",

  'verdict.saved': 'Evidence written to:',
  'verdict.saveFailed': 'Could not write evidence:',

  'typing.placeholder': 'Type into the device (ASCII only; Japanese cannot be sent)',
  'typing.send': 'Send',
  'typing.notAscii':
    "The device's input does not go through an IME, so Japanese cannot be sent (ASCII only)",

  'sheet.none': 'No test sheet is running yet (start a run and this opens it)',
  'sheet.openFailed': 'Cannot open the test sheet: {message}',

  'live.unsupported': 'This webview cannot decode H.264',
  'live.error': '{message}',

  'setup.title': 'Before you start',
  'setup.operator': '0. Your handle (recorded as who verified)',
  'setup.operator.placeholder': 'A handle, not a personal name (e.g. octocat)',
  'setup.device': '1. Pick what to look at',
  'setup.web': 'To verify a web page, enter its URL (takes priority over a device)',
  'live.desktop.note':
    'Clicks from here reach the app directly (it will not come to the front). ' +
    'Scrolling and dragging move your pointer there for a moment — ' +
    'operate the real window if that gets in the way.',
  'setup.app': 'To verify a desktop app, enter its name (the window owner)',
  'setup.app.placeholder': 'e.g. Calculator',
  'setup.web.placeholder': 'http://localhost:3000/ or https://…',
  'setup.browser': 'Browser to look with (its version is recorded)',
  'setup.browser.chrome': 'Chrome',
  'setup.browser.edge': 'Edge',
  'setup.browser.brave': 'Brave',
  'setup.browser.opera': 'Opera',
  'setup.browser.vivaldi': 'Vivaldi',
  'setup.browser.firefox': 'Firefox',
  'setup.browser.safari': 'Safari',
  'setup.browser.other': 'Other (give its path)',
  'setup.browser.path': 'Works if it is Chromium inside (e.g. a security suite browser)',
  'setup.browser.path.placeholder': 'C:\\...\\browser.exe',
  'setup.device.none': 'No device is visible. Plug one in over USB, or start an emulator',
  'setup.sheet': '2. Pick a test sheet',
  'setup.sheet.none': 'No test sheet (TSV) was found',
  'setup.pick': 'Choose another file…',
  'setup.start': 'Start verifying',
  'setup.starting': 'Getting ready…',
  'setup.blocked.operator.empty': 'Enter your handle to start (field 0)',
  'setup.blocked.operator.bad':
    'That handle has whitespace or a separator (/ \\), or is longer than 39 characters, so this cannot start (field 0)',

  'setup.blocked.device':
    'Nothing is selected to look at, so this cannot start (field 1: pick a device or enter a URL)',
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
