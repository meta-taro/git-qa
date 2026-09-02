//! ネイティブメニューの文言（Issue 011）。
//!
//! **メニューだけ英語になっていた。**自前で定義していないと、Tauri の既定
//! （File / Edit / View / Window / Help）がそのまま出る。
//!
//! 画面の中の文言は TypeScript 側のカタログ（`src/i18n/messages.ts`）にある。
//! **メニューはこちらにしか無い**ので、同じ文字列を 2 箇所に置いてはいない。
//! ただし「どの言語で出すか」の決め方は両側にある（webview は `navigator.languages`、
//! ここは環境変数）。**判定がずれる可能性が残る**ので、`GIT_QA_LANG` で揃えられるようにした。

use tauri::menu::{AboutMetadataBuilder, CheckMenuItem, Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 外観の選択肢。**メニューの id と、画面側が使う値を同じ文字列にしている。**
/// 2 つの語彙を持つと、片方だけ増やしたときに静かに食い違う。
pub const APPEARANCES: [&str; 3] = ["system", "light", "dark"];

/// 言語の選択肢。**`system` は「OS に従う」**で、実際に出す言語は画面側が決める
/// （`navigator.languages` のほうが、環境変数より確かなため）。
pub const LOCALES: [&str; 3] = ["system", "ja", "en"];

fn appearance_id(value: &str) -> String {
  format!("appearance:{value}")
}

fn locale_id(value: &str) -> String {
  format!("locale:{value}")
}

pub struct MenuText {
    pub app: &'static str,
    pub about: &'static str,
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
    pub view: &'static str,
    pub appearance: &'static str,
    pub appearance_system: &'static str,
    pub appearance_light: &'static str,
    pub appearance_dark: &'static str,
    pub language: &'static str,
    pub language_system: &'static str,
    pub language_ja: &'static str,
    pub language_en: &'static str,
}

const JA: MenuText = MenuText {
    app: "git-qa",
    about: "git-qa について",
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
    view: "表示",
    appearance: "外観",
    appearance_system: "システムに従う",
    appearance_light: "ライト",
    appearance_dark: "ダーク",
    language: "言語",
    language_system: "システムに従う",
    language_ja: "日本語",
    language_en: "English",
};

const EN: MenuText = MenuText {
    app: "git-qa",
    about: "About git-qa",
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
    view: "View",
    appearance: "Appearance",
    appearance_system: "Follow the system",
    appearance_light: "Light",
    appearance_dark: "Dark",
    language: "Language",
    language_system: "Follow the system",
    language_ja: "日本語",
    language_en: "English",
};

/// どの言語で出すか。**既定は日本語**（webview 側と同じ判断・`src/i18n/locale.ts`）。
///
/// `GIT_QA_LANG` が最優先。次に OS の `LC_ALL` / `LANG`。
/// **読めない値のときは日本語へ落とす。**黙って英語にすると、日本語の利用者が英語を見る。
fn text(effective: &str) -> &'static MenuText {
    match effective {
        "en" => &EN,
        _ => &JA,
    }
}

/// 起動時の言語。**画面がまだ何も言ってこない間**に使う見当。
///
/// `GIT_QA_LANG` が最優先。次に OS の `LC_ALL` / `LANG`。
/// **読めない値のときは日本語へ落とす。**黙って英語にすると、日本語の利用者が英語を見る。
pub fn locale_from_env() -> String {
    for key in ["GIT_QA_LANG", "LC_ALL", "LANG"] {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        let code = value.split(['-', '_', '.']).next().unwrap_or("").to_lowercase();
        if code == "ja" || code == "en" {
            return code;
        }
    }
    "ja".to_string()
}

/// アプリのメニューを組む。**最低限だけ置く。**
/// 既定のメニューには使っていない項目（File / Help）が並んでいて、押しても何も起きない。
pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    effective_locale: &str,
    locale_choice: &str,
    appearance: &str,
) -> tauri::Result<Menu<R>> {
    let t = text(effective_locale);

    // **版が分かる所を作る。**どれを触っているのか分からないまま報告を受けると、
    // 直っているはずのものが直っていない、という話が噛み合わない。
    // 個人名・個人メールは入れない（product-baseline §25）。
    let about = AboutMetadataBuilder::new()
        .name(Some("git-qa"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .license(Some("MIT"))
        .website(Some("https://github.com/meta-taro/git-qa"))
        .website_label(Some("リポジトリ"))
        .build();

    let app_menu = Submenu::with_items(
        app,
        t.app,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(t.about), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(t.quit))?,
        ],
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

    // **設定はメニューへ。**3 カラムは検証のためのものなので、そこを設定で埋めない。
    let appearance_menu = Submenu::with_items(
        app,
        t.appearance,
        true,
        &[
            &CheckMenuItem::with_id(
                app,
                appearance_id("system"),
                t.appearance_system,
                true,
                appearance == "system",
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                appearance_id("light"),
                t.appearance_light,
                true,
                appearance == "light",
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                appearance_id("dark"),
                t.appearance_dark,
                true,
                appearance == "dark",
                None::<&str>,
            )?,
        ],
    )?;

    // **言語もここから選べる。**OS に従うだけだと、選ぶ手段が無い。
    let language_menu = Submenu::with_items(
        app,
        t.language,
        true,
        &[
            &CheckMenuItem::with_id(
                app,
                locale_id("system"),
                t.language_system,
                true,
                locale_choice == "system",
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                locale_id("ja"),
                t.language_ja,
                true,
                locale_choice == "ja",
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                locale_id("en"),
                t.language_en,
                true,
                locale_choice == "en",
                None::<&str>,
            )?,
        ],
    )?;

    let view_menu = Submenu::with_items(app, t.view, true, &[&appearance_menu, &language_menu])?;

    let window_menu = Submenu::with_items(
        app,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::close_window(app, Some(t.close))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

/// 外観を切り替える。**メニューから選んだときも、画面から知らせてきたときも、ここを通る。**
///
/// 3 つを同時に揃える。1 つでも欠けると、見えている状態と実際が食い違う。
///
/// 1. ウィンドウの外観（枠は OS が描くので、CSS では変えられない）
/// 2. メニューのチェック
/// 3. 画面（ページの中の `color-scheme` は webview 側が持っている）
pub fn apply_appearance<R: Runtime>(app: &AppHandle<R>, value: &str) -> tauri::Result<()> {
  let theme = match value {
    "light" => Some(tauri::Theme::Light),
    "dark" => Some(tauri::Theme::Dark),
    // 知らない値は「OS に従う」に落とす。黙って暗くしない。
    _ => None,
  };
  let normalized = match theme {
    Some(tauri::Theme::Light) => "light",
    Some(tauri::Theme::Dark) => "dark",
    _ => "system",
  };

  {
    let state = app.state::<crate::state::SettingsState>();
    let mut settings = state.0.lock().unwrap();
    settings.appearance = normalized.to_string();
  }

  for window in app.webview_windows().values() {
    window.set_theme(theme)?;
  }

  if let Some(menu) = app.menu() {
    for candidate in APPEARANCES {
      if let Some(item) = menu.get(&appearance_id(candidate)) {
        if let Some(check) = item.as_check_menuitem() {
          check.set_checked(candidate == normalized)?;
        }
      }
    }
  }

  // 画面へ知らせる。**覚えるのは画面側**（次に開いたときに効かせるため）。
  app.emit("appearance", normalized)?;
  Ok(())
}

/// 言語を切り替える。**メニューの文言そのものが変わるので、組み直す。**
///
/// `choice` は人が選んだもの（`system` を含む）、`effective` は実際に出す言語。
/// `system` のときの判定は画面側が持っている（`navigator.languages` のほうが確か）。
pub fn apply_locale<R: Runtime>(
  app: &AppHandle<R>,
  choice: &str,
  effective: &str,
) -> tauri::Result<()> {
  let choice = if LOCALES.contains(&choice) { choice } else { "system" };
  let effective = if effective == "en" { "en" } else { "ja" };

  let appearance = {
    let state = app.state::<crate::state::SettingsState>();
    let mut settings = state.0.lock().unwrap();
    settings.locale_choice = choice.to_string();
    settings.locale_effective = effective.to_string();
    settings.appearance.clone()
  };

  // 組み直すとチェックは作り直しになるので、外観の選択もそのまま渡す。
  let menu = build(app, effective, choice, &appearance)?;
  app.set_menu(menu)?;

  app.emit("locale", choice)?;
  Ok(())
}
