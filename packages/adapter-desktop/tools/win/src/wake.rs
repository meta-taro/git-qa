//! Chromium で描かれている窓の、中身を触れるようにする（2026-09-12・Windows 機で実測）。
//!
//! **これが無いと、ブラウザと Electron アプリの中身が 1 行も読めず、1 つも押せない。**
//!
//! Chromium は、**支援技術が居ると分かるまで描画側のアクセシビリティを起こさない。**
//! 起きていない間、UI Automation から見えるのは**ブラウザ自身の枠**（戻る・進む・
//! アドレスバー）だけで、ページの中身は木に載っていない。
//!
//! 実測（同じページ・同じ窓）:
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
//!
//! **読むときだけの話ではない**（2026-09-14 に気づいた）。押す・打つ・回すも
//! 同じ木を辿るので、**起きていなければ何も見つからない。**だからここに集めて、
//! 触る側の入口から全部これを通す。

use std::time::Duration;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows::Win32::UI::Accessibility::{
    IUIAutomation, IUIAutomationCondition, TreeScope_Descendants, UIA_NamePropertyId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_GETOBJECT,
};

/// Chromium が描画に使う子窓のクラス名。**ブラウザも Electron も同じ名前。**
const WIDGET_CLASS: &str = "Chrome_RenderWidgetHostHWND";

/// UI Automation の根を求める合図（`UiaRootObjectId`）。これが Chromium の引き金になる。
const UIA_ROOT_OBJECT_ID: isize = -25;

/// 相手が固まっていたら諦める。**検証が道連れで止まらないこと。**
const SEND_TIMEOUT_MS: u32 = 1000;

/// 起きるまでの見張りの間隔。**固定で待たない** —— 遅い機械で静かに足りなくなる。
const WAKE_STEP: Duration = Duration::from_millis(100);

/// 見張りの回数（`WAKE_STEP` × これ）。実測は 222 ms で読めた。
const WAKE_TRIES: usize = 8;

/// **中身を触れる状態にしてから返る。**ネイティブの窓では、何もせずに返る。
///
/// **起きたかどうかは、描画側に中身が載ったかで見る。**読めた量が動かなくなったかで
/// 当てにいくと、**「まだ始まっていない」と「終わった」を取り違える** ——
/// どちらも「前と同じ」に見えるので、起きるのに 100 ms 以上かかる機械では、
/// **枠だけ見て成功したことになる。**それはこの道具でいちばん避けたい壊れ方。
pub unsafe fn ensure_awake(automation: &IUIAutomation, hwnd: HWND) {
    let widgets = chromium_widgets(hwnd);
    if widgets.is_empty() {
        return;
    }

    wake(&widgets);

    let Ok(named) = named_condition(automation) else {
        return;
    };
    for _ in 0..WAKE_TRIES {
        if has_content(automation, &named, &widgets) {
            return;
        }
        std::thread::sleep(WAKE_STEP);
    }
}

/// **名前を持つものだけ**を選ぶ条件。空の入れ物まで数えると、起きたかどうかが判らない。
pub unsafe fn named_condition(automation: &IUIAutomation) -> Result<IUIAutomationCondition, String> {
    automation
        .CreatePropertyCondition(UIA_NamePropertyId, &windows::core::VARIANT::from(""))
        .and_then(|empty| automation.CreateNotCondition(&empty))
        .map_err(|e| format!("探す条件を作れない: {e}"))
}

/// Chromium が描画している子窓を集める。**無ければ空**（ネイティブの窓）。
fn chromium_widgets(parent: HWND) -> Vec<HWND> {
    let mut found: Vec<HWND> = Vec::new();
    let ptr = &mut found as *mut Vec<HWND> as isize;
    // SAFETY: `visit` は下で定義してあり、`LPARAM` には上の `Vec` だけを渡す。
    unsafe {
        let _ = EnumChildWindows(parent, Some(visit), LPARAM(ptr));
    }
    found
}

/// 集めた子窓を起こす。**返りは見ない** —— 起きたかどうかは、中身が載ったかで判る。
fn wake(widgets: &[HWND]) {
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

/// 描画側に、名前を持つものが 1 つでも載ったか。**載っていれば、起き切っている。**
///
/// 起きていない間、描画の子窓は**空の器として在る**（掴めるが、中に何も無い）。
/// **「掴めた」を「触れる」と混同しない。**
unsafe fn has_content(
    automation: &IUIAutomation,
    named: &IUIAutomationCondition,
    widgets: &[HWND],
) -> bool {
    widgets.iter().any(|widget| {
        let Ok(root) = automation.ElementFromHandle(*widget) else {
            return false;
        };
        let Ok(found) = root.FindAll(TreeScope_Descendants, named) else {
            return false;
        };
        found.Length().unwrap_or(0) > 0
    })
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
