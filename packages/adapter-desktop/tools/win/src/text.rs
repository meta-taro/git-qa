//! 窓の中の文字を、位置つきで読む。
//!
//! macOS 側の段 1（AX）に当たる。**Windows では UI Automation がそれ。**
//!
//! macOS では Electron 相手に AX が `group` しか返さず、**段 2（Vision OCR）が要った**（C55）。
//! **Windows でも、同じ所で同じように詰まった**（2026-09-12・実測）——
//! ただし原因が違い、**段 2 を足さずに済んだ。**
//!
//! Chromium は**支援技術が居ると分かるまで描画側のアクセシビリティを起こさない。**
//! 起きていなければ、UI Automation から見えるのはブラウザの枠だけ（20 行・本文 0 行）。
//! **起こせば本文が座標つきで出る**（135 行）。起こし方は `wake` に置いた。
//!
//! 出す形は macOS 側と同じ `name \t x \t y \t w \t h`。読む側（TypeScript）を分けないため。

use windows::core::BSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
    TreeScope_Descendants, UIA_NamePropertyId,
};

use crate::wake::{WAKE_STEP, WAKE_TRIES, chromium_widgets, wake};

pub fn read(hwnd: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;

    // SAFETY: COM は使う前に始めて、終わったら閉じる。
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM を始められない: {e}"))?;
        let out = read_awake(hwnd);
        CoUninitialize();
        out
    }
}

/// Chromium なら起こしてから読む。**ネイティブの窓では、何も足さない。**
unsafe fn read_awake(hwnd: HWND) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| format!("UI Automation を始められない: {e}"))?;
    let named = named_condition(&automation)?;

    let widgets = chromium_widgets(hwnd);
    if !widgets.is_empty() {
        wake(&widgets);

        // **起きたかどうかは、描画側に中身が載ったかで見る。**
        //
        // 読めた量が動かなくなったかで当てにいくと、**「まだ始まっていない」と
        // 「終わった」を取り違える** —— どちらも「前と同じ」に見えるので、
        // 起きるのに 100 ms 以上かかる機械では、**枠だけ読んで成功したことになる。**
        // それはこの道具でいちばん避けたい壊れ方（静かに間違える）。
        for _ in 0..WAKE_TRIES {
            if has_content(&automation, &named, &widgets) {
                break;
            }
            std::thread::sleep(WAKE_STEP);
        }
    }

    walk(&automation, &named, hwnd)
}

/// **名前を持つものだけ**を選ぶ条件。空の入れ物まで出すと、読む側で捨てることになる。
unsafe fn named_condition(automation: &IUIAutomation) -> Result<IUIAutomationCondition, String> {
    automation
        .CreatePropertyCondition(UIA_NamePropertyId, &windows::core::VARIANT::from(""))
        .and_then(|empty| automation.CreateNotCondition(&empty))
        .map_err(|e| format!("探す条件を作れない: {e}"))
}

/// 描画側に、名前を持つものが 1 つでも載ったか。**載っていれば、起き切っている。**
///
/// 起きていない間、描画の子窓は**空の器として在る**（掴めるが、中に何も無い）。
/// **「掴めた」を「読める」と混同しない。**
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

unsafe fn walk(
    automation: &IUIAutomation,
    named: &IUIAutomationCondition,
    hwnd: HWND,
) -> Result<String, String> {
    let root: IUIAutomationElement = automation
        .ElementFromHandle(hwnd)
        .map_err(|e| format!("その窓を掴めない: {e}"))?;

    let found = root
        .FindAll(TreeScope_Descendants, named)
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
