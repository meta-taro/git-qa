//! Chromium で描かれている窓の、中身を読めるようにする（2026-09-12・Windows 機で実測）。
//!
//! **これが無いと、ブラウザと Electron アプリの中身が 1 行も読めない。**
//!
//! Chromium は、**支援技術が居ると分かるまで描画側のアクセシビリティを起こさない。**
//! 起きていない間、UI Automation から見えるのは**ブラウザ自身の枠**（戻る・進む・
//! アドレスバー）だけで、ページの中身は木に載っていない。
//!
//! 実測（この道具・同じページ・同じ窓）:
//!
//! ```text
//! 起こす前                              20 行（枠だけ。本文は 0 行）
//! --force-renderer-accessibility 付き   131 行（本文が座標つきで出る）
//! 起こしたあと（フラグ無し・起動済み）  135 行
//! ```
//!
//! **起動フラグでは解決にしない。**検証の相手は顧客のアプリで、こちらから
//! 付け直して起動できるとは限らない（Electron も同じ）。**道具の側から起こす。**
//!
//! 起こし方は、描画を担う子窓（`Chrome_RenderWidgetHostHWND`）へ `WM_GETOBJECT` を
//! 送るだけ。**画面読み上げソフトがやっていることと同じ**で、相手を前面に出さない。

use std::time::Duration;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_GETOBJECT,
};

/// Chromium が描画に使う子窓のクラス名。**ブラウザも Electron も同じ名前。**
const WIDGET_CLASS: &str = "Chrome_RenderWidgetHostHWND";

/// UI Automation の根を求める合図（`UiaRootObjectId`）。これが Chromium の引き金になる。
const UIA_ROOT_OBJECT_ID: isize = -25;

/// 相手が固まっていたら諦める。**検証が道連れで止まらないこと。**
const SEND_TIMEOUT_MS: u32 = 1000;

/// 起きるまでの見張り。**固定で待たない** —— 遅い機械で静かに足りなくなる。
pub const WAKE_STEP: Duration = Duration::from_millis(100);

/// 見張りの回数（`WAKE_STEP` × これ）。実測は 222 ms で読めた。
pub const WAKE_TRIES: usize = 8;

/// Chromium が描画している子窓を集める。**無ければ空**（ネイティブの窓）。
pub fn chromium_widgets(parent: HWND) -> Vec<HWND> {
    let mut found: Vec<HWND> = Vec::new();
    let ptr = &mut found as *mut Vec<HWND> as isize;
    // SAFETY: `visit` は下で定義してあり、`LPARAM` には上の `Vec` だけを渡す。
    unsafe {
        let _ = EnumChildWindows(parent, Some(visit), LPARAM(ptr));
    }
    found
}

/// 集めた子窓を起こす。**返りは見ない** —— 起きたかどうかは、読めた中身で判る。
pub fn wake(widgets: &[HWND]) {
    for widget in widgets {
        let mut _result: usize = 0;
        // SAFETY: 送り先は上で数えた子窓だけ。固まっていても `SMTO_ABORTIFHUNG` で戻る。
        unsafe {
            let _: LRESULT = SendMessageTimeoutW(
                *widget,
                WM_GETOBJECT,
                WPARAM(0),
                LPARAM(UIA_ROOT_OBJECT_ID),
                SMTO_ABORTIFHUNG,
                SEND_TIMEOUT_MS,
                Some(&mut _result),
            );
        }
    }
}

unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> windows::Win32::Foundation::BOOL {
    let found = &mut *(param.0 as *mut Vec<HWND>);

    let mut name = [0u16; 64];
    let wrote = GetClassNameW(hwnd, &mut name);
    if wrote > 0 && String::from_utf16_lossy(&name[..wrote as usize]) == WIDGET_CLASS {
        found.push(hwnd);
    }
    TRUE
}
