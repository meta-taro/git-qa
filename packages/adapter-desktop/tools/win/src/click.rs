//! 本物のクリック（meta-taro/git-qa#42）。
//!
//! `Invoke` では `pointerdown` もフォーカスも起きない。**人と同じ道で押す**ために、
//! カーソルを置いて左ボタンを押して離す。
//!
//! **座標で押すのは危ない**（C57・macOS で別のアプリを押した）。だから 2 つ確かめてから押す。
//!
//! 1. 相手が前面に出たこと（`key::in_front` がやる。出なければ押さない）
//! 2. **その点の一番上が、相手の窓であること**（常に手前に出る窓が重なっていれば押さない）
//!
//! 押したら、**カーソルを元の場所へ戻す。**人の手元を動かしたままにしない。

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEINPUT, SendInput,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GA_ROOT, GetAncestor, GetCursorPos, SetCursorPos, WindowFromPoint,
};

pub fn click_at(hwnd: HWND, x: i32, y: i32) -> Result<(), String> {
    let mut before = POINT::default();
    // SAFETY: 読むだけ。読めなければ戻さない（戻す先が分からない）。
    let had_cursor = unsafe { GetCursorPos(&mut before) }.is_ok();

    let mut refused: Option<String> = None;
    let sent = crate::key::in_front(hwnd, || {
        // SAFETY: 前面に出たことは `in_front` が確かめてある。ここでは点の上を確かめる。
        unsafe {
            let top = GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT);
            if top != hwnd {
                refused = Some(format!(
                    "（{x}, {y}）の一番上が相手の窓ではないので、クリックしなかった"
                ));
                return;
            }
            let _ = SetCursorPos(x, y);
            SendInput(
                &[button(MOUSEEVENTF_LEFTDOWN), button(MOUSEEVENTF_LEFTUP)],
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    });

    if had_cursor {
        // SAFETY: 読んだ場所へ戻すだけ。
        let _ = unsafe { SetCursorPos(before.x, before.y) };
    }

    sent?;
    match refused {
        Some(reason) => Err(reason),
        None => Ok(()),
    }
}

fn button(flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
