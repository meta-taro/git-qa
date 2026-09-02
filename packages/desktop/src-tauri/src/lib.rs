mod menu;

/// ウィンドウ（タイトルバー）の外観を切り替える。
///
/// **CSS はページの中しか変えない。**枠は OS が描くので、ここで受けて切り替える。
/// `system` のときは `None` を渡し、OS の設定に従わせる。
#[tauri::command]
fn set_appearance(app: tauri::AppHandle, appearance: String) -> Result<(), String> {
  menu::apply(&app, &appearance).map_err(|error| error.to_string())
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
    .on_menu_event(|app, event| {
      // 外観のメニューだけを見る。ほかは Tauri の既定の項目なので、ここへは来ない。
      if let Some(value) = event.id().0.strip_prefix("appearance:") {
        if let Err(error) = menu::apply(app, value) {
          // 握り潰さない。切り替わらなかったことが分からないと、人は何度も押す。
          log::error!("外観を切り替えられない: {error}");
        }
      }
    })
    .invoke_handler(tauri::generate_handler![set_appearance])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
