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
    IUIAutomationValuePattern, TreeScope_Descendants, UIA_IsValuePatternAvailablePropertyId,
    UIA_ValuePatternId,
};

use crate::wake::{ensure_awake, named_condition};

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

/// Chromium なら起こしてから読む。**ネイティブの窓では、何も足さない**（`wake` が判断する）。
unsafe fn read_awake(hwnd: HWND) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|e| format!("UI Automation を始められない: {e}"))?;

    ensure_awake(&automation, hwnd);

    let named = named_condition(&automation)?;
    walk(&automation, &named, hwnd)
}

unsafe fn walk(
    automation: &IUIAutomation,
    named: &IUIAutomationCondition,
    hwnd: HWND,
) -> Result<String, String> {
    let root: IUIAutomationElement = automation
        .ElementFromHandle(hwnd)
        .map_err(|e| format!("その窓を掴めない: {e}"))?;

    // **名前を持つもの**と、**中身を持つもの**（入力欄）の両方を集める。
    let has_value = automation
        .CreatePropertyCondition(
            UIA_IsValuePatternAvailablePropertyId,
            &windows::core::VARIANT::from(true),
        )
        .map_err(|e| format!("探す条件を作れない: {e}"))?;
    let wanted = automation
        .CreateOrCondition(named, &has_value)
        .map_err(|e| format!("探す条件を作れない: {e}"))?;

    let found = root
        .FindAll(TreeScope_Descendants, &wanted)
        .map_err(|e| format!("中身を数えられない: {e}"))?;
    let count = found.Length().unwrap_or(0);

    let mut out = String::new();
    for i in 0..count {
        let Ok(element) = found.GetElement(i) else { continue };
        let Ok(rect) = element.CurrentBoundingRectangle() else { continue };

        let name = element.CurrentName().unwrap_or_default().to_string();
        if !name.trim().is_empty() {
            out.push_str(&line(&name, rect));
        }

        // **入力欄の中身も読む**（2026-09-14・メモ帳では 1 行も読めなかった）。
        // 名前は欄の見出し（「検索」）で、**中身は人が入れた値。**
        // 「入力した値が正しく表示される」を確かめる手順は、こちらが要る。
        if let Some(value) = value_of(&element) {
            if !value.trim().is_empty() && value != name {
                out.push_str(&line(&value, rect));
            }
        }
    }
    Ok(out)
}

/// 入力欄の中身。**パスワード欄は読まない。**
///
/// 証跡は git で管理できる形で残る（ワークスペース）。**画面に写るのと、
/// 文字として残るのは重さが違う** —— 検索できる形で伏字が解けることになる。
/// **読めるからといって読まない**（product-baseline §14 / §21）。
unsafe fn value_of(element: &IUIAutomationElement) -> Option<String> {
    if element.CurrentIsPassword().unwrap_or_default().as_bool() {
        return None;
    }
    let pattern: IUIAutomationValuePattern = element.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
    let value: BSTR = pattern.CurrentValue().ok()?;
    Some(value.to_string())
}

/// 1 行 1 件。**タブと改行は潰す**（読む側の区切りを壊さない）。
fn line(text: &str, rect: windows::Win32::Foundation::RECT) -> String {
    format!(
        "{}\t{}\t{}\t{}\t{}\n",
        text.replace(['\t', '\n', '\r'], " "),
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    )
}
