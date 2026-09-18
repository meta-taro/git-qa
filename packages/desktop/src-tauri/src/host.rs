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

/// **Windows の拡張長パス（`\\?\`）を外す**（2026-09-16・Windows 機で実測）。
///
/// Tauri の `resource_dir()` は Windows で `\\?\C:\...` を返す。**node はこの形を
/// 解決できない。**
///
/// ```text
/// node "\\?\C:\...\host-bundle.mjs" --serve
///   → Error: EISDIR: illegal operation on a directory, lstat 'C:'
/// ```
///
/// 配布した `.exe` を入れて動かしたところ、**実行器が 368 ms で死んでいた。**
/// 死ぬのは `spawn` の後なので、下の失敗の手当てには引っかからない。画面は理由を
/// 出さないまま「はじめかた」を出し続け、**そういう仕様に見えてしまう。**
///
/// macOS にはこの前置きが付かないので、**あちらの挙動は変わらない。**
fn plain(path: std::path::PathBuf) -> std::path::PathBuf {
  let said = path.to_string_lossy();
  match said.strip_prefix(r"\\?\") {
    Some(rest) => std::path::PathBuf::from(rest),
    None => path,
  }
}

/// 標準出力の 1 行目に出る `[git-qa] 画面から始める: <url>` を読む。
fn parse_url(line: &str) -> Option<String> {
  let marker = "画面から始める: ";
  line.find(marker).map(|at| line[at + marker.len()..].trim().to_string())
}

/// Node 側を起こし、入口サーバの URL を拾う。
pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let script = plain(
    app
      .path()
      .resource_dir()?
      .join("resources")
      .join("host-bundle.mjs"),
  );

  let state = app.state::<HostState>();

  let mut child = match Command::new("node")
    .arg(&script)
    .arg("--serve")
    // **判定を出した道具の版を、証跡へ運ぶ**（2026-09-18）。
    // 実行器は別のプロセスなので、渡さないと自分が何版なのかを知らない。
    .env("GIT_QA_RELEASE", crate::release())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
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

  /*
   * **起きたことと、生きていることは別**（2026-09-16・Windows 機で実測）。
   *
   * `spawn` は成功したのに、実行器が 368 ms で死んでいた（渡したパスが
   * `\\?\` 付きで、node が解決できなかった）。**上の手当ては `spawn` の失敗しか
   * 見ていない**ので、この死に方は素通りする。画面は理由を出さないまま
   * 「はじめかた」を出し続け、**そういう仕様に見えてしまう。**
   *
   * 標準エラーを拾って、**死んだ理由を画面へ渡す。**
   */
  if let Some(stderr) = child.stderr.take() {
    let app = app.clone();
    std::thread::spawn(move || {
      let mut said = String::new();
      for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        eprintln!("{line}");
        if said.len() < 600 {
          said.push_str(&line);
          said.push('\n');
        }
      }
      if said.trim().is_empty() {
        return;
      }
      let state = app.state::<HostState>();

      // **URL が取れているなら、標準エラーは「失敗」ではない。**
      // 実行器は動いていて、ただ何か言っただけ（警告など）。ここで理由を立てると、
      // **動いているのにエラー画面**になる。
      if state.url.lock().unwrap().is_some() {
        return;
      }

      // **先に入っている理由を上書きしない**（そちらのほうが早い＝根に近い）。
      let mut slot = state.error.lock().unwrap();
      if slot.is_none() {
        *slot = Some(format!("実行器が止まった:\n{}", said.trim_end()));
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
  use super::{parse_url, plain};

  /// **Windows でだけ付く前置きを外す**（2026-09-16・実測）。
  /// 付いたまま渡すと node が解決できず、**実行器が 368 ms で死ぬ。**
  #[test]
  fn 拡張長パスの前置きを外す() {
    let got = plain(std::path::PathBuf::from(r"\\?\C:\app\resources\host-bundle.mjs"));
    assert_eq!(got, std::path::PathBuf::from(r"C:\app\resources\host-bundle.mjs"));
  }

  /// **付いていないものは、そのまま。**macOS の道は 1 ミリも変えない。
  #[test]
  fn 前置きが無ければそのまま() {
    let same = std::path::PathBuf::from("/Applications/git-qa.app/resources/host-bundle.mjs");
    assert_eq!(plain(same.clone()), same);
  }

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
