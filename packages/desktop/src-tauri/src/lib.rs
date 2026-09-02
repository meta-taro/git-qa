mod menu;

/// ウィンドウ（タイトルバー）の外観を切り替える。
///
/// **CSS はページの中しか変えない。**枠は OS が描くので、ここで受けて切り替える。
/// `system` のときは `None` を渡し、OS の設定に従わせる。
#[tauri::command]
fn set_appearance(window: tauri::WebviewWindow, appearance: String) -> Result<(), String> {
  let theme = match appearance.as_str() {
    "light" => Some(tauri::Theme::Light),
    "dark" => Some(tauri::Theme::Dark),
    // 知らない値は「OS に従う」に落とす。黙って暗くしない。
    _ => None,
  };
  window.set_theme(theme).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // 自前のメニューを置く。置かないと Tauri の既定（英語）がそのまま出る（Issue 011）。
      app.set_menu(menu::build(app.handle())?)?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![set_appearance])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
