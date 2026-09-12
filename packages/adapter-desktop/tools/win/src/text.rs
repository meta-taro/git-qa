//! 窓の中の文字を、位置つきで読む。
//!
//! macOS 側の段 1（AX）に当たる。**Windows では UI Automation がそれ。**
//!
//! macOS では Electron 相手に AX が `group` しか返さず、**段 2（Vision OCR）が要った**（C55）。
//! UI Automation は Chromium が中身を出してくれるので、**段 1 だけで読める見込みがある。**
//! 読めなかったら、そのときに段 2 を足す —— **要ると分かってから足す。**
//!
//! 出す形は macOS 側と同じ `name \t x \t y \t w \t h`。読む側（TypeScript）を分けないため。

use windows::core::BSTR;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants, UIA_NamePropertyId,
};

pub fn read(hwnd: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;

    // SAFETY: COM は使う前に始めて、終わったら閉じる。
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM を始められない: {e}"))?;
        let out = walk(hwnd);
        CoUninitialize();
        out
    }
}

unsafe fn walk(hwnd: windows::Win32::Foundation::HWND) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| format!("UI Automation を始められない: {e}"))?;

    let root: IUIAutomationElement = automation
        .ElementFromHandle(hwnd)
        .map_err(|e| format!("その窓を掴めない: {e}"))?;

    // **名前を持つものだけ。**空の入れ物まで出すと、読む側で捨てることになる。
    let condition = automation
        .CreatePropertyCondition(UIA_NamePropertyId, &windows::core::VARIANT::from(""))
        .and_then(|empty| automation.CreateNotCondition(&empty))
        .map_err(|e| format!("探す条件を作れない: {e}"))?;

    let found = root
        .FindAll(TreeScope_Descendants, &condition)
        .map_err(|e| format!("中身を数えられない: {e}"))?;
    let count = found.Length().unwrap_or(0);

    let mut out = String::new();
    for i in 0..count {
        let Ok(element) = found.GetElement(i) else { continue };
        let name: BSTR = element.CurrentName().unwrap_or_default();
        let name = name.to_string();
        if name.trim().is_empty() {
            continue;
        }
        let Ok(rect) = element.CurrentBoundingRectangle() else { continue };
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\n",
            name.replace(['\t', '\n', '\r'], " "),
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
        ));
    }
    Ok(out)
}
