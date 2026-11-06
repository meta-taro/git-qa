//! 外から「このシートのこのケースを確かめてくれ」と呼ばれる口（C112・2026-11-06）。
//!
//! ```text
//! git-qa://run?sheet=<検証シートの絶対パス>&case=<No.>&target=<見る相手>
//! ```
//!
//! 漏れを並べる側の道具（tadori）が、画面のアイコンから git-qa を呼ぶ。
//! **ここは受け取って画面へ渡すだけ。**読み方（何を受け取り、何を断るか）は画面側
//! （`setup/launch.ts`）にあり、そちらは検査してある。
//!
//! 来る道は 2 つ。
//! - **起動と同時に**：macOS は Apple event、Windows は起動の引数で来る。画面がまだ無いので、
//!   ここに置いて、画面が起きたら聞きに来る（`take_launch_url`）
//! - **起きている間に**：同じ所へ置き、**合図だけ**を画面へ送る（本文を乗せると、
//!   起動と同時に来た分と二重に始まる）。画面は合図を受けて聞きに来る

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 画面がまだ取りに来ていない頼み。**最後の 1 本だけ**（二重に来たら新しい方）。
#[derive(Default)]
pub struct LaunchState {
  url: Mutex<Option<String>>,
}

/// 渡されたものの中から `git-qa://` の URL を 1 本選ぶ。**最後のもの。**
///
/// Windows では 2 つ目の起動の引数（実行ファイルのパスも混ざる）がそのまま来るので、
/// **形で選ぶ**。大文字小文字は見ない（OS が揃えないことがある）。
pub fn pick<I, S>(items: I) -> Option<String>
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  items
    .into_iter()
    .filter_map(|item| {
      let said = item.as_ref().trim();
      let lowered = said.to_ascii_lowercase();
      if lowered.starts_with("git-qa://") {
        Some(said.to_string())
      } else {
        None
      }
    })
    .last()
}

/// 頼みを受け取る。置いて、窓を前へ出し、画面へ合図を送る。
pub fn received<R: Runtime, S: AsRef<str>>(app: &AppHandle<R>, items: &[S]) {
  let Some(url) = pick(items) else {
    return;
  };
  *app.state::<LaunchState>().url.lock().unwrap() = Some(url);

  // **呼ばれたら前へ出る。**裏にいたままだと、呼んだ側は何も起きなかったと思う。
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
  if let Err(error) = app.emit("launch-url", ()) {
    // 握り潰さない。合図が届かないと、画面は起動時にしか取りに来ない。
    log::error!("外からの起動の合図を画面へ送れない: {error}");
  }
}

/// 画面が取りに来る口。**取ったら消す**（二重に始めない）。
#[tauri::command]
pub fn take_launch_url(state: tauri::State<'_, LaunchState>) -> Option<String> {
  state.url.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
  use super::pick;

  #[test]
  fn 引数の中から_git_qa_の_url_だけを選ぶ() {
    let items = [
      r"C:\Program Files\git-qa\git-qa.exe",
      "git-qa://run?sheet=C%3A%5Cdocs%5C001.tsv&case=7",
    ];
    assert_eq!(
      pick(items),
      Some("git-qa://run?sheet=C%3A%5Cdocs%5C001.tsv&case=7".to_string())
    );
  }

  #[test]
  fn 無ければ_none() {
    assert_eq!(pick(["--serve", "https://example.test/"]), None);
    assert_eq!(pick(Vec::<String>::new()), None);
  }

  #[test]
  fn 二重に来たら新しい方() {
    let items = ["git-qa://run?sheet=%2Fa.tsv", "git-qa://run?sheet=%2Fb.tsv"];
    assert_eq!(pick(items), Some("git-qa://run?sheet=%2Fb.tsv".to_string()));
  }

  #[test]
  fn 大文字でも選ぶ() {
    assert_eq!(
      pick(["GIT-QA://run?sheet=%2Fa.tsv"]),
      Some("GIT-QA://run?sheet=%2Fa.tsv".to_string())
    );
  }
}
