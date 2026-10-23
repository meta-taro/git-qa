//! 前面に出さずに、押す・打つ・回す。
//!
//! macOS 側の `git-qa-input`（`AXPress` / `keystroke` / scroll）に当たる。
//!
//! **座標を送って操作する形にしない。**送ると、その位置に**別の窓が重なっていたら
//! そちらが動く**（macOS でまさにそれを踏んだ・C57）。UI Automation のパターンは
//! **要素そのものに伝える**ので、相手を前面に出さずに済む。
//!
//! | | 使うもの | 前面に出るか |
//! |---|---|---|
//! | 押す | **本物のクリック**（#42）。確かめられなければ `Invoke` → `SelectionItem` → `ExpandCollapse` → `LegacyIAccessible`（C106） | **出る**（戻す） |
//! | 打つ | `ValuePattern.SetValue` | 出ない |
//! | 回す | `ScrollPattern.Scroll` | 出ない |
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
//!
//! 持たない要素（ただの箱・独自描画）もある。そのときは
//! **黙って何もしないのではなく、持っていないと言う。**

use windows::core::BSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, ExpandCollapseState_Expanded, IUIAutomation, IUIAutomationCondition,
    IUIAutomationElement, IUIAutomationExpandCollapsePattern, IUIAutomationInvokePattern,
    IUIAutomationLegacyIAccessiblePattern, IUIAutomationScrollPattern,
    IUIAutomationSelectionItemPattern, IUIAutomationValuePattern, ScrollAmount_LargeDecrement,
    ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, TreeScope_Descendants,
    UIA_ExpandCollapsePatternId, UIA_InvokePatternId,
    UIA_IsExpandCollapsePatternAvailablePropertyId, UIA_IsInvokePatternAvailablePropertyId,
    UIA_IsLegacyIAccessiblePatternAvailablePropertyId, UIA_IsScrollPatternAvailablePropertyId,
    UIA_IsSelectionItemPatternAvailablePropertyId, UIA_IsValuePatternAvailablePropertyId,
    UIA_LegacyIAccessiblePatternId, UIA_ScrollPatternId, UIA_SelectionItemPatternId,
    UIA_ValuePatternId, UIA_PROPERTY_ID,
};

use crate::wake::ensure_awake;

/// 押す。**人が押すのと同じ、本物のクリックで押す**（meta-taro/git-qa#42）。
///
/// `Invoke` は要素に「押された」と伝えるだけで、**`pointerdown` もフォーカスも起きない。**
/// 表のセルは `pointerdown` で選ぶので、`Invoke` では選択が移らず、その後の Enter も届かなかった
/// （2026-09-27・md-business の表で実測）。macOS は最初から本物のクリックで押している（C57）。
///
/// **代わりに、相手が前面に出る。**前に出たことを確かめ、**その点の一番上が相手の窓だと
/// 確かめてから**押す（別の窓を押さない・C57 で macOS が踏んだ）。押したらカーソルを戻す。
/// **前面は、手が止まってから呼ぶ側が返す**（C108）。
///
/// **確かめられなければ、要素の口で押す**（これまでの押し方）。要素そのものに伝えるので、
/// 別の窓を押すことは無い。**押せないよりは、今までどおり押すほうがよい。**
///
/// 答えは `押し方` か `押し方<TAB>本物のクリックが断られた理由`。
/// **断られた理由は捨てない**（2026-10-23・Windows の Electron で、タブと開くボタンだけが押せず、
/// 足跡が空で、なぜ本物のクリックが通らなかったのかが分からなかった）。
pub fn press(hwnd: &str, x: &str, y: &str) -> Result<String, String> {
    let (target, px, py) = place(hwnd, x, y)?;
    // **どれで押したかを言う**（#42）。証跡の手順の足跡に付く。
    let refused = match crate::click::click_at(target, px, py) {
        Ok(()) => return Ok("click".into()),
        Err(reason) => reason,
    };
    match by_pattern(target, px, py) {
        Ok(how) => Ok(format!("{how}\t{refused}")),
        Err(why) => Err(format!("{refused}。要素の口でも押せなかった: {why}")),
    }
}

/// 要素の口で押す。**その窓の中で**、その場所にあるいちばん小さいものに伝える。
///
/// **Invoke だけでは足りない**（2026-10-23）。Chromium は
/// `role="tab"` を選ぶ口（SelectionItem）、`aria-expanded` のボタンを開く口（ExpandCollapse）で出し、
/// **Invoke を持たせない。**人が押したときに起きることに合わせて、口を選ぶ。
///
/// **先に 3 つの口のどれかを持つものを探す。**口ごとに探すと、Invoke を持つ大きな親が
/// 小さなタブより先に当たり、**押すつもりの無い所を押す。**
/// 既定の動作（LegacyIAccessible）は、ほぼ全部が持っているので最後に回す。
fn by_pattern(hwnd: HWND, x: i32, y: i32) -> Result<String, String> {
    with_automation(hwnd, |automation, root| unsafe {
        let any = any_of(
            automation,
            &[
                UIA_IsInvokePatternAvailablePropertyId,
                UIA_IsSelectionItemPatternAvailablePropertyId,
                UIA_IsExpandCollapsePatternAvailablePropertyId,
            ],
        )?;
        if let Ok(element) = smallest_at(root, &any, x, y, "押せる") {
            return press_element(&element);
        }
        let legacy = any_of(
            automation,
            &[UIA_IsLegacyIAccessiblePatternAvailablePropertyId],
        )?;
        let element = smallest_at(root, &legacy, x, y, "押せる")?;
        let pattern: IUIAutomationLegacyIAccessiblePattern = element
            .GetCurrentPatternAs(UIA_LegacyIAccessiblePatternId)
            .map_err(|e| format!("既定の動作の口を取り出せない: {e}"))?;
        pattern
            .DoDefaultAction()
            .map_err(|e| format!("既定の動作で押せなかった: {e}"))?;
        Ok("default".into())
    })
}

/// 持っている口で押す。**Invoke → 選ぶ → 開く／閉じる**の順。
unsafe fn press_element(element: &IUIAutomationElement) -> Result<String, String> {
    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
    {
        pattern.Invoke().map_err(|e| format!("押せなかった: {e}"))?;
        return Ok("invoke".into());
    }
    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
    {
        pattern.Select().map_err(|e| format!("選べなかった: {e}"))?;
        return Ok("select".into());
    }
    let pattern: IUIAutomationExpandCollapsePattern = element
        .GetCurrentPatternAs(UIA_ExpandCollapsePatternId)
        .map_err(|e| format!("押す口を取り出せない: {e}"))?;
    // **人が押したのと同じく、開いていれば閉じる。**
    if pattern.CurrentExpandCollapseState() == Ok(ExpandCollapseState_Expanded) {
        pattern
            .Collapse()
            .map_err(|e| format!("閉じられなかった: {e}"))?;
        return Ok("collapse".into());
    }
    pattern.Expand().map_err(|e| format!("開けなかった: {e}"))?;
    Ok("expand".into())
}

/// 「どれかの口を持つ」条件。
unsafe fn any_of(
    automation: &IUIAutomation,
    available: &[UIA_PROPERTY_ID],
) -> Result<IUIAutomationCondition, String> {
    let mut condition: Option<IUIAutomationCondition> = None;
    for id in available {
        let one = automation
            .CreatePropertyCondition(*id, &windows::core::VARIANT::from(true))
            .map_err(|e| format!("探す条件を作れない: {e}"))?;
        condition = Some(match condition {
            None => one,
            Some(before) => automation
                .CreateOrCondition(&before, &one)
                .map_err(|e| format!("探す条件を作れない: {e}"))?,
        });
    }
    condition.ok_or_else(|| "探す条件が無い".into())
}

/// 文字を入れる。
///
/// **1 文字ずつ打たない。**`SetValue` は欄の中身をそのまま置き換えるので、
/// **焦点も要らず、IME も通らない** —— 日本語もそのまま入る（実測で確かめること）。
///
/// **打つ前の中身は消える。**「追記する」ではなく「その欄はこの値になる」という操作。
/// 検証シートの「〇〇と入力する」は、だいたいこちらの意味で書かれている。
pub fn type_text(hwnd: &str, x: &str, y: &str, text: &str) -> Result<String, String> {
    let (hwnd, x, y) = place(hwnd, x, y)?;
    let text = text.to_string();

    with_automation(hwnd, move |automation, root| {
        let element = unsafe {
            at_point(
                automation,
                root,
                UIA_IsValuePatternAvailablePropertyId,
                x,
                y,
                "文字を入れられる",
            )
        }?;
        let pattern: IUIAutomationValuePattern =
            unsafe { element.GetCurrentPatternAs(UIA_ValuePatternId) }
                .map_err(|e| format!("文字を入れる口を取り出せない: {e}"))?;

        // **読み取り専用の欄に、入れたことにしない。**
        if unsafe { pattern.CurrentIsReadOnly() }
            .unwrap_or_default()
            .as_bool()
        {
            return Err("その欄は読み取り専用で、文字を入れられない".into());
        }

        unsafe { pattern.SetValue(&BSTR::from(text.as_str())) }
            .map_err(|e| format!("文字を入れられなかった: {e}"))?;
        Ok(String::new())
    })
}

/// 回す。**`notches` は正で下、負で上。**
///
/// 画素では指定しない —— UI Automation は「1 画面分」「1 段分」でしか回せない。
/// **1 段がどれだけかは相手が決める**ので、こちらは回数だけ渡す。
pub fn scroll(hwnd: &str, x: &str, y: &str, notches: &str) -> Result<String, String> {
    let (hwnd, x, y) = place(hwnd, x, y)?;
    let notches: i32 = notches
        .parse()
        .map_err(|_| format!("回す量が数でない: {notches}"))?;

    with_automation(hwnd, move |automation, root| {
        if notches == 0 {
            return Ok(String::new());
        }
        let element = unsafe {
            at_point(
                automation,
                root,
                UIA_IsScrollPatternAvailablePropertyId,
                x,
                y,
                "回せる",
            )
        }?;
        let pattern: IUIAutomationScrollPattern =
            unsafe { element.GetCurrentPatternAs(UIA_ScrollPatternId) }
                .map_err(|e| format!("回す口を取り出せない: {e}"))?;

        let way = if notches > 0 {
            ScrollAmount_LargeIncrement
        } else {
            ScrollAmount_LargeDecrement
        };
        for _ in 0..notches.abs() {
            // **端まで来たら、そこで終わる。**相手が断ってくる。
            if unsafe { pattern.Scroll(ScrollAmount_NoAmount, way) }.is_err() {
                break;
            }
        }
        Ok(String::new())
    })
}

/// 引数を数に直す。**形のおかしいものは、そこで止める**（別の窓を触らない）。
fn place(hwnd: &str, x: &str, y: &str) -> Result<(HWND, i32, i32), String> {
    let hwnd = crate::parse_hwnd(hwnd)?;
    let x: i32 = x.parse().map_err(|_| format!("x が数でない: {x}"))?;
    let y: i32 = y.parse().map_err(|_| format!("y が数でない: {y}"))?;
    Ok((hwnd, x, y))
}

/// COM を始め、窓を掴み、**中身が触れる状態にしてから**渡す。終わったら必ず閉じる。
fn with_automation<F>(hwnd: HWND, body: F) -> Result<String, String>
where
    F: FnOnce(&IUIAutomation, &IUIAutomationElement) -> Result<String, String>,
{
    // SAFETY: COM は使う前に始めて、終わったら閉じる。
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM を始められない: {e}"))?;

        let out = (|| {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("UI Automation を始められない: {e}"))?;

            // **起きていなければ、Chromium の中身は 1 つも見つからない**（`wake` に理由がある）。
            ensure_awake(&automation, hwnd);

            let root: IUIAutomationElement = automation
                .ElementFromHandle(hwnd)
                .map_err(|e| format!("その窓を掴めない: {e}"))?;
            body(&automation, &root)
        })();

        CoUninitialize();
        out
    }
}

/// その場所を覆っている要素のうち、**求める口を持っていて、いちばん小さいもの。**
///
/// 入れ子になっているとき、外側の器ではなく**人が触っているつもりのもの**を選ぶ。
unsafe fn at_point(
    automation: &IUIAutomation,
    root: &IUIAutomationElement,
    available: UIA_PROPERTY_ID,
    x: i32,
    y: i32,
    what: &str,
) -> Result<IUIAutomationElement, String> {
    let condition = any_of(automation, &[available])?;
    smallest_at(root, &condition, x, y, what)
}

/// その点を含む、いちばん小さいもの。**画面に出ていないものは選ばない。**
unsafe fn smallest_at(
    root: &IUIAutomationElement,
    condition: &IUIAutomationCondition,
    x: i32,
    y: i32,
    what: &str,
) -> Result<IUIAutomationElement, String> {
    let found = root
        .FindAll(TreeScope_Descendants, condition)
        .map_err(|e| format!("中身を数えられない: {e}"))?;
    let count = found.Length().unwrap_or(0);

    let mut best: Option<(IUIAutomationElement, i64)> = None;
    for i in 0..count {
        let Ok(element) = found.GetElement(i) else {
            continue;
        };
        // **画面に出ていないものは押さない**（#42。裏のタブの要素が同じ座標に重なっている）。
        if element.CurrentIsOffscreen().unwrap_or_default().as_bool() {
            continue;
        }
        let Ok(rect) = element.CurrentBoundingRectangle() else {
            continue;
        };
        if x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom {
            continue;
        }
        let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
        if best.as_ref().is_none_or(|(_, small)| area < *small) {
            best = Some((element, area));
        }
    }

    // **持っていないことを、できたことにしない。**
    best.map(|(element, _)| element).ok_or_else(|| {
        format!(
            "そこは{what}作りになっていない（{x}, {y}）。\
             その窓の中に、そこを覆う{what}要素がありません"
        )
    })
}
