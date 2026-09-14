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

use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};

mod input;
mod key;
mod shot;
mod text;
mod wake;
mod window;

fn main() -> ExitCode {
    see_real_pixels();

    let args: Vec<String> = env::args().skip(1).collect();
    let said: Vec<&str> = args.iter().map(String::as_str).collect();

    let result = match said.as_slice() {
        ["windows", app] => window::list(app),
        ["shot", hwnd, out] => shot::capture(hwnd, out),
        ["text", hwnd] => text::read(hwnd),
        ["press", hwnd, x, y] => input::press(hwnd, x, y),
        ["type", hwnd, x, y, text] => input::type_text(hwnd, x, y, text),
        ["scroll", hwnd, x, y, notches] => input::scroll(hwnd, x, y, notches),
        ["key", hwnd, key] => key::press_key(hwnd, key),
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

/// **画面の拡大表示を、そのままの画素で見る**（2026-09-14・Windows 機で実測して足した）。
///
/// 宣言しないプロセスを、Windows は「DPI 非対応」として扱い、**座標を勝手に換算して見せる。**
/// 換算された座標の中では辻褄が合うので、**押す所は当たる。**気づけない。
///
/// 壊れるのは**残る絵**のほう。`GetWindowRect` が換算後の小さい値を返し、
/// その大きさの器に `PrintWindow` が実寸で描くので、**窓の左上だけが切り取られる。**
///
/// ```text
/// 125%   窓は実寸 1181x1020   撮れた絵 945x816    右と下が落ちる
/// 150%   窓は実寸 1418x1008   撮れた絵 945x672    本文がまるごと消える
/// ```
///
/// **一見すると普通のスクリーンショットに見える。**画面の 2〜4 割が無いことを、
/// 証跡は何も言わない。**検証したように見える証跡が残る** —— いちばん悪い壊れ方。
///
/// **顧客の Windows はたいてい拡大表示が入っている**（この機械も、推奨は 125%）。
fn see_real_pixels() {
    // SAFETY: 何も持たない宣言で、失敗しても困らない（100% の機械では何も変わらない）。
    unsafe {
        // **失敗しても進む。**古い Windows では宣言の口が無いが、そこでは拡大表示も効かない。
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
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
  git-qa-win type <窓> <x> <y> <文字>  その欄の中身を置き換える
  git-qa-win scroll <窓> <x> <y> <回数>  回す（正で下・負で上）
  git-qa-win key <窓> <キー>         キーを押す（前面に一瞬出る）
  git-qa-win exe <プロセス番号>      実行ファイルの場所";
