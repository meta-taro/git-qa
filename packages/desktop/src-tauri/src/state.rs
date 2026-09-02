//! いま選ばれている設定（言語・外観）。**メニューを組み直しても失わないために持つ。**
//!
//! 覚えるのは画面側（`localStorage`）で、ここは**起動中のあいだの控え**。
//! 二重に正本を持たないよう、保存はしない。

use std::sync::Mutex;

pub struct Settings {
  /// 人が選んだ言語（`system` / `ja` / `en`）。メニューのチェックに使う。
  pub locale_choice: String,
  /// 実際に出す言語（`ja` / `en`）。`system` のときは画面側が判定したもの。
  pub locale_effective: String,
  /// 外観（`system` / `light` / `dark`）。
  pub appearance: String,
}

pub struct SettingsState(pub Mutex<Settings>);

impl SettingsState {
  pub fn new(locale_effective: &str) -> Self {
    Self(Mutex::new(Settings {
      locale_choice: "system".to_string(),
      locale_effective: locale_effective.to_string(),
      appearance: "system".to_string(),
    }))
  }
}
