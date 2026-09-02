//! ネイティブメニューの文言（Issue 011）。
//!
//! **メニューだけ英語になっていた。**自前で定義していないと、Tauri の既定
//! （File / Edit / View / Window / Help）がそのまま出る。
//!
//! 画面の中の文言は TypeScript 側のカタログ（`src/i18n/messages.ts`）にある。
//! **メニューはこちらにしか無い**ので、同じ文字列を 2 箇所に置いてはいない。
//! ただし「どの言語で出すか」の決め方は両側にある（webview は `navigator.languages`、
//! ここは環境変数）。**判定がずれる可能性が残る**ので、`GIT_QA_LANG` で揃えられるようにした。

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub struct MenuText {
    pub app: &'static str,
    pub quit: &'static str,
    pub edit: &'static str,
    pub undo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub window: &'static str,
    pub minimize: &'static str,
    pub close: &'static str,
}

const JA: MenuText = MenuText {
    app: "git-qa",
    quit: "git-qa を終了",
    edit: "編集",
    undo: "取り消す",
    cut: "カット",
    copy: "コピー",
    paste: "ペースト",
    select_all: "すべてを選択",
    window: "ウインドウ",
    minimize: "しまう",
    close: "閉じる",
};

const EN: MenuText = MenuText {
    app: "git-qa",
    quit: "Quit git-qa",
    edit: "Edit",
    undo: "Undo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    window: "Window",
    minimize: "Minimize",
    close: "Close",
};

/// どの言語で出すか。**既定は日本語**（webview 側と同じ判断・`src/i18n/locale.ts`）。
///
/// `GIT_QA_LANG` が最優先。次に OS の `LC_ALL` / `LANG`。
/// **読めない値のときは日本語へ落とす。**黙って英語にすると、日本語の利用者が英語を見る。
fn text() -> &'static MenuText {
    for key in ["GIT_QA_LANG", "LC_ALL", "LANG"] {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        let code = value.split(['-', '_', '.']).next().unwrap_or("").to_lowercase();
        match code.as_str() {
            "ja" => return &JA,
            "en" => return &EN,
            _ => continue,
        }
    }
    &JA
}

/// アプリのメニューを組む。**最低限だけ置く。**
/// 既定のメニューには使っていない項目（File / Help）が並んでいて、押しても何も起きない。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let t = text();

    let app_menu = Submenu::with_items(
        app,
        t.app,
        true,
        &[&PredefinedMenuItem::quit(app, Some(t.quit))?],
    )?;

    // 判定の理由を書き写すために、コピーと貼り付けは要る。
    let edit_menu = Submenu::with_items(
        app,
        t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t.undo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t.cut))?,
            &PredefinedMenuItem::copy(app, Some(t.copy))?,
            &PredefinedMenuItem::paste(app, Some(t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(t.select_all))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::close_window(app, Some(t.close))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}
