//! 前面に出さずに押す。
//!
//! macOS 側の `git-qa-input press`（`AXPress`）に当たる。
//!
//! **座標を送って押す形にしない。**送ると、その位置に**別の窓が重なっていたら
//! そちらが押される**（macOS でまさにそれを踏んだ・C57）。
//! UI Automation の `Invoke` は、**要素そのものに「押された」と伝える**ので、
//! 相手を前面に出さずに済む。
//!
//! `Invoke` を持たない要素（ただの箱・独自描画）もある。そのときは
//! **黙って何もしないのではなく、持っていないと言う。**

use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationInvokePattern, UIA_InvokePatternId,
};

pub fn press(hwnd: &str, x: &str, y: &str) -> Result<String, String> {
    let _ = crate::parse_hwnd(hwnd)?;
    let x: i32 = x.parse().map_err(|_| format!("x が数でない: {x}"))?;
    let y: i32 = y.parse().map_err(|_| format!("y が数でない: {y}"))?;

    // SAFETY: COM は使う前に始めて、終わったら閉じる。
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM を始められない: {e}"))?;
        let out = invoke_at(x, y);
        CoUninitialize();
        out
    }
}

unsafe fn invoke_at(x: i32, y: i32) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| format!("UI Automation を始められない: {e}"))?;

    let element = automation
        .ElementFromPoint(POINT { x, y })
        .map_err(|e| format!("その場所に要素が無い（{x}, {y}）: {e}"))?;

    let pattern: IUIAutomationInvokePattern = element
        .GetCurrentPatternAs(UIA_InvokePatternId)
        .map_err(|_| {
            // **持っていないことを、押せたことにしない。**
            let name = element.CurrentName().unwrap_or_default().to_string();
            format!("そこは押せる作りになっていない（{name}）")
        })?;

    pattern.Invoke().map_err(|e| format!("押せなかった: {e}"))?;
    Ok(String::new())
}
