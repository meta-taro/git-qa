mod menu;
mod state;

use tauri::Manager;

/// ウィンドウ（タイトルバー）の外観を切り替える。
///
/// **CSS はページの中しか変えない。**枠は OS が描くので、ここで受けて切り替える。
/// `system` のときは `None` を渡し、OS の設定に従わせる。
#[tauri::command]
fn set_appearance(app: tauri::AppHandle, appearance: String) -> Result<(), String> {
  menu::apply_appearance(&app, &appearance).map_err(|error| error.to_string())
}

/// 画面が選んだ言語を受ける。`choice` は人の選択、`effective` は実際に出す言語。
#[tauri::command]
fn set_locale(app: tauri::AppHandle, choice: String, effective: String) -> Result<(), String> {
  menu::apply_locale(&app, &choice, &effective).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // 自前のメニューを置く。置かないと Tauri の既定（英語）がそのまま出る（Issue 011）。
      // **画面がまだ何も言ってこない間**は、環境変数から見当を付ける。
      let effective = menu::locale_from_env();
      app.manage(state::SettingsState::new(&effective));
      app.set_menu(menu::build(app.handle(), &effective, "system", "system")?)?;
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
    .invoke_handler(tauri::generate_handler![set_appearance, set_locale])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
