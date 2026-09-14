//! 前面に出さずに押す。
//!
//! macOS 側の `git-qa-input press`（`AXPress`）に当たる。
//!
//! **座標を送って押す形にしない。**送ると、その位置に**別の窓が重なっていたら
//! そちらが押される**（macOS でまさにそれを踏んだ・C57）。
//! UI Automation の `Invoke` は、**要素そのものに「押された」と伝える**ので、
//! 相手を前面に出さずに済む。
//!
//! **押し方だけ直しても足りなかった**（2026-09-12・Windows 機で実測）。
//! 最初の実装は `ElementFromPoint` で探していた。これは**その座標の最前面**を返すので、
//! **重なった別の窓の要素を掴む** —— 避けたはずの問題が、探す側に残っていた。
//!
//! ```text
//! press <chrome の窓> 156 73
//!   → そこは押せる作りになっていない（Omnibox Popup）   ← 別の窓を掴んでいる
//! ```
//!
//! だから**探す範囲を、渡された窓の中に閉じる。**重なりも、前面かどうかも関係なくなる。
//! （それまで `hwnd` は受け取るだけで捨てていた。**相手を指定しているのに使っていなかった。**）
//!
//! `Invoke` を持たない要素（ただの箱・独自描画）もある。そのときは
//! **黙って何もしないのではなく、持っていないと言う。**

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    TreeScope_Descendants, UIA_InvokePatternId, UIA_IsInvokePatternAvailablePropertyId,
};

pub fn press(hwnd: &str, x: &str, y: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;
    let x: i32 = x.parse().map_err(|_| format!("x が数でない: {x}"))?;
    let y: i32 = y.parse().map_err(|_| format!("y が数でない: {y}"))?;

    // SAFETY: COM は使う前に始めて、終わったら閉じる。
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM を始められない: {e}"))?;
        let out = invoke_in(hwnd, x, y);
        CoUninitialize();
        out
    }
}

/// **その窓の中で**、その場所にある押せるものを押す。
unsafe fn invoke_in(hwnd: HWND, x: i32, y: i32) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| format!("UI Automation を始められない: {e}"))?;

    let root: IUIAutomationElement = automation
        .ElementFromHandle(hwnd)
        .map_err(|e| format!("その窓を掴めない: {e}"))?;

    // **押せるものだけを集める。**押せない箱まで見ると、
    // その場所を覆っている大きな入れ物を掴んで「押せない」と答えることになる。
    let invokable = automation
        .CreatePropertyCondition(
            UIA_IsInvokePatternAvailablePropertyId,
            &windows::core::VARIANT::from(true),
        )
        .map_err(|e| format!("探す条件を作れない: {e}"))?;

    let found = root
        .FindAll(TreeScope_Descendants, &invokable)
        .map_err(|e| format!("中身を数えられない: {e}"))?;
    let count = found.Length().unwrap_or(0);

    let mut best: Option<(IUIAutomationElement, i64)> = None;
    for i in 0..count {
        let Ok(element) = found.GetElement(i) else { continue };
        let Ok(rect) = element.CurrentBoundingRectangle() else { continue };
        if x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom {
            continue;
        }
        // **いちばん小さいものを採る。**入れ子になっているとき、外側の器ではなく
        // 人が押しているつもりのものを選ぶ。
        let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
        if best.as_ref().is_none_or(|(_, small)| area < *small) {
            best = Some((element, area));
        }
    }

    let Some((element, _)) = best else {
        // **持っていないことを、押せたことにしない。**
        return Err(format!(
            "そこは押せる作りになっていない（{x}, {y}）。\
             その窓の中に、そこを覆う押せる要素がありません"
        ));
    };

    let pattern: IUIAutomationInvokePattern = element
        .GetCurrentPatternAs(UIA_InvokePatternId)
        .map_err(|e| format!("押す口を取り出せない: {e}"))?;

    pattern.Invoke().map_err(|e| format!("押せなかった: {e}"))?;
    Ok(String::new())
}
