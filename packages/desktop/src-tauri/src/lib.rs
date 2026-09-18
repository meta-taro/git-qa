mod host;
mod menu;
mod open;
mod state;

use tauri::{Emitter, Manager};

/// **この配布物の名乗り**（2026-09-18）。
///
/// `beta.3` も `beta.12` も、名乗りは `0.2.0` のままだった。**どれを使っているか、
/// 本人にも分からない。**試験導入先で「beta.8 で直した」が効いていない場面があり、
/// **こちらも相手も、何を触っているのか確かめられなかった。**
///
/// **インストーラの版番号（`CARGO_PKG_VERSION`）は触らない。**MSI は
/// `major.minor.patch` しか受け取らないので、そこにタグを入れると
/// **Windows の配布が壊れる。**建てるときに `GIT_QA_RELEASE` でタグを渡し、
/// **名乗りだけを本物にする。**
pub fn release() -> String {
  match option_env!("GIT_QA_RELEASE") {
    Some(said) if !said.trim().is_empty() => said.trim().to_string(),
    // 手元で建てたもの。**配ったものと混ぜない。**
    _ => format!("{}-dev", env!("CARGO_PKG_VERSION")),
  }
}

/// 画面へ名乗りを渡す。**人が見て報告に書ける所**に出すため。
#[tauri::command]
fn app_release() -> String {
  release()
}

/// ウィンドウ（タイトルバー）の外観を切り替える。
///
/// **CSS はページの中しか変えない。**枠は OS が描くので、ここで受けて切り替える。
/// `system` のときは `None` を渡し、OS の設定に従わせる。
#[tauri::command]
fn set_appearance(app: tauri::AppHandle, appearance: String) -> Result<(), String> {
  menu::apply_appearance(&app, &appearance).map_err(|error| error.to_string())
}

/// 入口サーバの URL。**画面は起動直後にここへ聞きに来る**（配布物では URL を
/// クエリで渡せないため）。まだ起きていなければ空を返す。
#[tauri::command]
fn setup_url(state: tauri::State<'_, host::HostState>) -> Result<Option<String>, String> {
  if let Some(error) = state.error.lock().unwrap().clone() {
    return Err(error);
  }
  Ok(state.url.lock().unwrap().clone())
}

/// 検証シートを開く。開き方は `md-business` / `reveal` / `default`。
#[tauri::command]
fn open_sheet(path: String, mode: String) -> Result<(), String> {
  let mode = open::OpenMode::parse(&mode).ok_or_else(|| format!("知らない開き方: {mode}"))?;
  open::open(&path, mode)
}

/// 画面が選んだ言語を受ける。`choice` は人の選択、`effective` は実際に出す言語。
#[tauri::command]
fn set_locale(app: tauri::AppHandle, choice: String, effective: String) -> Result<(), String> {
  menu::apply_locale(&app, &choice, &effective).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 検証シートを人が選べるようにする。**配布物では作業ディレクトリが `/` になる**ので、
    // 探して並べるだけでは足りない（実機で「検証シートが無い」と出た）。
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      // 自前のメニューを置く。置かないと Tauri の既定（英語）がそのまま出る（Issue 011）。
      // **画面がまだ何も言ってこない間**は、環境変数から見当を付ける。
      let effective = menu::locale_from_env();
      app.manage(state::SettingsState::new(&effective));
      app.set_menu(menu::build(app.handle(), &effective, "system", "system")?)?;

      // **配布物では Node 側をここで起こす。**開発中（`pnpm app`）は既に起きているので、
      // その場合は起こさない（二重に立てると端末を掴み合う）。
      app.manage(host::HostState::default());
      if std::env::var("GIT_QA_EMBEDDED_HOST").as_deref() != Ok("0") && !cfg!(debug_assertions) {
        host::spawn(app.handle())?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_menu_event(|app, event| {
      // 外観のメニューだけを見る。ほかは Tauri の既定の項目なので、ここへは来ない。
      if let Some(value) = event.id().0.strip_prefix("appearance:") {
        if let Err(error) = menu::apply_appearance(app, value) {
          // 握り潰さない。切り替わらなかったことが分からないと、人は何度も押す。
          log::error!("外観を切り替えられない: {error}");
        }
      }
      if let Some(action) = event.id().0.strip_prefix("file:") {
        // **開くファイルは画面が持っている**（走らせているシートの場所）。
        // ここでは、押されたことだけを伝える。
        if let Err(error) = app.emit("menu-action", format!("file:{action}")) {
          log::error!("メニューの操作を画面へ伝えられない: {error}");
        }
      }
      if let Some(choice) = event.id().0.strip_prefix("locale:") {
        // `system` のときに実際どちらで出すかは画面が決める。ここでは見当で組み、
        // 画面から `set_locale` が返ってきた時点で正しくなる。
        let effective = if choice == "system" {
          menu::locale_from_env()
        } else {
          choice.to_string()
        };
        if let Err(error) = menu::apply_locale(app, choice, &effective) {
          log::error!("言語を切り替えられない: {error}");
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      set_appearance,
      set_locale,
      open_sheet,
      setup_url,
      app_release
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // 閉じるときに Node 側も道連れにする。残ると端末を掴んだままになる。
      // **ExitRequested だけでは足りない。**窓を閉じただけで終わらない経路があり、
      // Node 側が残って端末を掴んだままになった（2026-09-04・12 個残っていた）。
      if matches!(
        event,
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
      ) {
        host::stop(app);
      }
    });
}

#[cfg(test)]
mod tests {
  use super::release;

  /// **名乗りは、必ず何かを言う。**空だと「版が消えた」ように見える。
  #[test]
  fn 名乗りは空にならない() {
    let said = release();
    assert!(!said.trim().is_empty());
    assert_eq!(said, said.trim());
  }

  /// **手元で建てたものは、配ったものと混ぜない。**
  ///
  /// `GIT_QA_RELEASE` は建てたときに焼き付くので、ここでは
  /// **「渡していないなら `dev` が付く」**ことだけを確かめる。
  #[test]
  fn 渡さずに建てたら_dev_が付く() {
    if option_env!("GIT_QA_RELEASE").is_none() {
      assert!(release().ends_with("-dev"), "{}", release());
    }
  }
}
