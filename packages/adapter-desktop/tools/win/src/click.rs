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

use std::thread::sleep;
use std::time::Duration;

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEINPUT, SendInput,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GA_ROOT, GetAncestor, GetCursorPos, SetCursorPos, WindowFromPoint,
};

/// ダブルクリック（#42）。**前面・点の上を確かめられなければ、押さずに理由を返す**
/// （`Invoke` に 2 回押す口は無いので、落とす先が無い）。
pub fn double_click(hwnd: &str, x: &str, y: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;
    let x: i32 = x.parse().map_err(|_| format!("x が数でない: {x}"))?;
    let y: i32 = y.parse().map_err(|_| format!("y が数でない: {y}"))?;
    clicks(hwnd, x, y, 2)?;
    Ok("dblclick".into())
}

pub fn click_at(hwnd: HWND, x: i32, y: i32) -> Result<(), String> {
    clicks(hwnd, x, y, 1)
}

/// 押して離すの間。**ダブルクリックの判定時間（既定 500ms）より十分短く。**
const STEP: Duration = Duration::from_millis(30);

/// ボタンを 1 つ動かす。
unsafe fn send(flags: MOUSE_EVENT_FLAGS) {
    SendInput(&[button(flags)], std::mem::size_of::<INPUT>() as i32);
}

/// 押して離すを `times` 回。
fn clicks(hwnd: HWND, x: i32, y: i32, times: usize) -> Result<(), String> {
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
            /*
             * **人の押し方に寄せる**（#42・2026-09-27 の報告 B）。
             * 一瞬で置いて押して離すと、**タブが切り替わらなかった**（Chromium が取りこぼす疑い・未確認）。
             * カーソルを置いてから少し待ち、押して少し待ってから離す。
             * 間はダブルクリックの判定時間（既定 500ms）より十分短くしてある。
             */
            let _ = SetCursorPos(x, y);
            sleep(STEP);
            for _ in 0..times {
                send(MOUSEEVENTF_LEFTDOWN);
                sleep(STEP);
                send(MOUSEEVENTF_LEFTUP);
                sleep(STEP);
            }
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
