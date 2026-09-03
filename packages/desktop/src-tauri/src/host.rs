//! 配布物の中で、Node 側（入口サーバと実行器）を起こす。
//!
//! **アプリを叩くだけで動くようにするため**（Issue 011 段階 3 の続き）。
//! 開発中は `pnpm app` が Node を起こしてから画面を開くが、配布物にはそれが無い。
//!
//! **Node が要る。**`adb` と同じで、この道具が前提にする外部のものとして扱う。
//! 見つからないときは黙って空の画面を出さず、理由を画面へ渡す。

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime};

/// Node 側の様子。画面はこれを聞きに来る。
#[derive(Default)]
pub struct HostState {
  /// 入口サーバの URL。起きるまでは None。
  pub url: Mutex<Option<String>>,
  /// 起こせなかった理由。**握り潰さない。**
  pub error: Mutex<Option<String>>,
  child: Mutex<Option<Child>>,
}

/// 標準出力の 1 行目に出る `[git-qa] 画面から始める: <url>` を読む。
fn parse_url(line: &str) -> Option<String> {
  let marker = "画面から始める: ";
  line.find(marker).map(|at| line[at + marker.len()..].trim().to_string())
}

/// Node 側を起こし、入口サーバの URL を拾う。
pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let script = app
    .path()
    .resource_dir()?
    .join("resources")
    .join("host-bundle.mjs");

  let state = app.state::<HostState>();

  let mut child = match Command::new("node")
    .arg(&script)
    .arg("--serve")
    .stdout(Stdio::piped())
    .stdin(Stdio::piped())
    .spawn()
  {
    Ok(child) => child,
    Err(error) => {
      // **黙って空の画面を出さない。**Node が入っていないことが人に見えるようにする。
      *state.error.lock().unwrap() =
        Some(format!("Node を起こせない（node が要る）: {error}"));
      return Ok(());
    }
  };

  if let Some(stdout) = child.stdout.take() {
    let app = app.clone();
    std::thread::spawn(move || {
      for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        // Node 側のログは、そのまま出す（人が追える所に置く）。
        println!("{line}");
        if let Some(url) = parse_url(&line) {
          let state = app.state::<HostState>();
          *state.url.lock().unwrap() = Some(url);
        }
      }
    });
  }

  *state.child.lock().unwrap() = Some(child);
  Ok(())
}

/// 終わるときに道連れにする。残ると端末を掴んだままになる。
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
  let state = app.state::<HostState>();
  let taken = { state.child.lock().unwrap().take() };
  if let Some(mut child) = taken {
    let _ = child.kill();
    let _ = child.wait();
  }
}

#[cfg(test)]
mod tests {
  use super::parse_url;

  #[test]
  fn 標準出力から入口のurlを拾う() {
    let line = "[git-qa] 画面から始める: http://127.0.0.1:5000/setup/abc";
    assert_eq!(parse_url(line).as_deref(), Some("http://127.0.0.1:5000/setup/abc"));
  }

  #[test]
  fn 関係のない行は拾わない() {
    assert_eq!(parse_url("[git-qa] 証跡: runs/a/run.json"), None);
  }
}
