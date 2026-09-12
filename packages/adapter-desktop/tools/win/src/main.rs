//! Windows のデスクトップアプリを、外から見て・触る道具。
//!
//! macOS 側の 3 本（`git-qa-ocr` / `git-qa-input` / `git-qa-record`）に当たるものを、
//! **1 本にまとめてある。**Windows では窓・文字・操作がどれも同じ口（Win32 と UI Automation）
//! から取れるので、分ける理由が無い。
//!
//! ```text
//! git-qa-win windows <アプリ名>      窓を探す
//! git-qa-win shot <窓> <出力.png>    その窓だけを撮る
//! git-qa-win text <窓>               読める文字と、その位置
//! git-qa-win press <窓> <x> <y>      前面に出さずに押す
//! git-qa-win exe <プロセス番号>      実行ファイルの場所（指紋用）
//! ```
//!
//! **出す形は macOS 側と揃える**（TSV・1 行 1 件）。読む側（TypeScript）を分けないため。

use std::env;
use std::process::ExitCode;

mod input;
mod shot;
mod text;
mod wake;
mod window;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let said: Vec<&str> = args.iter().map(String::as_str).collect();

    let result = match said.as_slice() {
        ["windows", app] => window::list(app),
        ["shot", hwnd, out] => shot::capture(hwnd, out),
        ["text", hwnd] => text::read(hwnd),
        ["press", hwnd, x, y] => input::press(hwnd, x, y),
        ["exe", pid] => window::exe_path(pid),
        _ => {
            eprintln!("{}", USAGE);
            return ExitCode::from(2);
        }
    };

    match result {
        Ok(out) => {
            print!("{out}");
            ExitCode::SUCCESS
        }
        // **理由をそのまま出す。**握り潰すと、動かない理由が人に見えなくなる。
        Err(reason) => {
            eprintln!("{reason}");
            ExitCode::FAILURE
        }
    }
}

/// `hwnd` は数で来る。**形のおかしいものは、そこで止める**（別の窓を触らない）。
pub fn parse_hwnd(said: &str) -> Result<windows::Win32::Foundation::HWND, String> {
    let raw: isize = said
        .parse()
        .map_err(|_| format!("窓の番号が数でない: {said}"))?;
    Ok(windows::Win32::Foundation::HWND(raw as *mut core::ffi::c_void))
}

const USAGE: &str = "\
使い方:
  git-qa-win windows <アプリ名>      窓を探す
  git-qa-win shot <窓> <出力.png>    その窓だけを撮る
  git-qa-win text <窓>               読める文字と、その位置
  git-qa-win press <窓> <x> <y>      前面に出さずに押す
  git-qa-win exe <プロセス番号>      実行ファイルの場所";
