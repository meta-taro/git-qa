//! 検証シートを人が実物で確かめるための口（Issue 011）。
//!
//! 画面から見えているのは端末の映像だけなので、**いま何を走らせているのか**を
//! 人がファイルとして開けるようにする。
//!
//! **パスは画面から渡ってくる。**Node 側が実際に読んだシートの場所なので、
//! ここで組み立てはしない（組み立てると、走らせているものと別のファイルを開きうる）。

use std::path::Path;
use std::process::Command;

/// 開き方。**知らない値は受け取らない**（黙って別の開き方にしない）。
pub enum OpenMode {
  /// md-business（この検証シート書式の出どころ）で開く。
  MdBusiness,
  /// ファイル管理ソフトで、そのファイルを選んだ状態にする。
  Reveal,
  /// OS の既定のアプリで開く。
  Default,
}

impl OpenMode {
  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "md-business" => Some(Self::MdBusiness),
      "reveal" => Some(Self::Reveal),
      "default" => Some(Self::Default),
      _ => None,
    }
  }
}

fn run(command: &mut Command) -> Result<(), String> {
  let status = command
    .status()
    .map_err(|error| format!("開けなかった: {error}"))?;
  if status.success() {
    return Ok(());
  }
  Err(format!("開けなかった（終了コード {:?}）", status.code()))
}

/// ファイルを開く。**存在しないパスは開きに行かない**（何も起きない理由が分からなくなる）。
pub fn open(path: &str, mode: OpenMode) -> Result<(), String> {
  if !Path::new(path).exists() {
    return Err(format!("ファイルが見つからない: {path}"));
  }

  #[cfg(target_os = "macos")]
  match mode {
    OpenMode::MdBusiness => run(Command::new("open").args(["-a", "md-business", path])),
    OpenMode::Reveal => run(Command::new("open").args(["-R", path])),
    OpenMode::Default => run(Command::new("open").arg(path)),
  }

  #[cfg(target_os = "windows")]
  match mode {
    // Windows での md-business の置き場所が分からないので、まだ支えない。
    // **黙って別のアプリで開かない。**
    OpenMode::MdBusiness => Err("Windows ではまだ md-business を直接開けない".to_string()),
    OpenMode::Reveal => run(Command::new("explorer").args(["/select,", path])),
    OpenMode::Default => run(Command::new("cmd").args(["/C", "start", "", path])),
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  match mode {
    OpenMode::MdBusiness => Err("この環境ではまだ md-business を直接開けない".to_string()),
    OpenMode::Reveal => {
      let parent = Path::new(path).parent().unwrap_or(Path::new("."));
      run(Command::new("xdg-open").arg(parent))
    }
    OpenMode::Default => run(Command::new("xdg-open").arg(path)),
  }
}
