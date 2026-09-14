//! キーを押す（meta-taro/git-qa#10 / #6 の残り）。
//!
//! **ここだけ、相手が前面に出る。**押す・打つ・回すは UI Automation のパターンで
//! 要素に直接伝えられるが、**キーを送る口が UI Automation には無い。**
//!
//! 実測（2026-09-14・Chromium の窓へ Enter を送って確かめた）:
//!
//! ```text
//! A  最上位の窓へ PostMessage            効かない（前面は奪わない）
//! B  描画の子窓へ PostMessage            効かない（前面は奪わない）
//! C  前面に出して SendInput              届く。**前面に出る**
//! ```
//!
//! Chromium は焦点の状態を見ているので、**投げ込んだキーは無視される。**
//! 残るのは `SendInput` で、これは**焦点のある窓へ届く**仕組みなので、
//! 送る前に相手を前面へ出すしかない。
//!
//! ## 前面に出せなかったら、送らない
//!
//! **`SendInput` は宛先を持たない。**そのとき焦点のある窓へ入る。だから
//! **相手を前面に出せていないのに送ると、まったく別の窓へ打ち込む。**
//!
//! これは作っている最中に実際にやった —— 窓が見つからないまま送って、
//! **端末へ文字が入った。**画面には何も出ず、送った側は成功したと思っている。
//! **いちばん悪い壊れ方**なので、**前面に出たことを確かめてからでないと送らない。**
//!
//! 終わったら**元の窓へ前面を返す。**macOS 側と同じ扱い（C57 追記）。

use std::thread::sleep;
use std::time::Duration;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY, VK_CONTROL,
    VK_LWIN, VK_MENU, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
};

/// 前面に出るのを待つ間隔と回数。**出たことを確かめるまで送らない。**
const FRONT_STEP: Duration = Duration::from_millis(50);
const FRONT_TRIES: usize = 20;

/// 積んだキーが相手に読み出されるまでの間。**ここを省くと、戻した先の窓へ入る。**
const SETTLE: Duration = Duration::from_millis(250);

pub fn press_key(hwnd: &str, key: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;
    let (modifiers, main) = parse(key)?;

    // SAFETY: 触るのは渡された窓と、いま前面にある窓だけ。
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return Err(format!("その窓はもう無い（{}）", hwnd.0 as isize));
        }

        let came_from = GetForegroundWindow();

        // **まず素で頼む。**これで出られるなら、余計なことはしない。
        bring_to_front(hwnd, came_from);
        let mut front = waited_front(hwnd);

        if !front {
            // **前面ロックを外してから、もう一度頼む**（下の `unlock_front` に理由がある）。
            unlock_front();
            bring_to_front(hwnd, came_from);
            front = waited_front(hwnd);
        }

        // **出たことを確かめる。**出ていないのに送ると、別の窓へ打ち込む。
        if !front {
            return Err("相手を前面に出せなかったので、キーを送っていない\
                 （送ると、そのとき前面にある別の窓へ入ります）"
                .into());
        }

        send(&modifiers, main);

        /*
         * **積んだだけでは、まだ届いていない**（2026-09-14・実測）。
         *
         * `SendInput` は入力を積む。読み出すのは相手で、そこには間がある。
         * **積んだ直後に前面を戻すと、キーは戻した先の窓へ入る** ——
         * 送った側は成功したと思っていて、相手では何も起きていない。
         *
         * 実測: 待ちを入れる前は `Ctrl+T` が exit 0 で返るのに、
         * **新しいタブが開かなかった。**
         */
        sleep(SETTLE);

        // **前面を元へ返す。**返せなくても、キーは既に届いている。
        if came_from != hwnd && !came_from.is_invalid() {
            let _ = SetForegroundWindow(came_from);
        }
    }
    Ok(String::new())
}

/// 前面に出るまで、少しだけ待つ。**出なければ `false`。**
unsafe fn waited_front(hwnd: HWND) -> bool {
    for _ in 0..FRONT_TRIES {
        if GetForegroundWindow() == hwnd {
            return true;
        }
        sleep(FRONT_STEP);
    }
    false
}

/// **前面ロックを外す**（2026-09-14・実測）。
///
/// Windows は**最後に入力を受けたプロセス**以外の前面奪取を禁じている。
/// 背景から起こした道具はその権利を持たないので、`SetForegroundWindow` は
/// **成功したように返って何も起きない。**
///
/// ```text
/// 素の SetForegroundWindow          前面は変わらなかった
/// ALT を 1 回押してから同じことをする  前面が変わった
/// ```
///
/// ALT を 1 回叩くとロックが外れる。**これは行儀の良い手ではない。**
/// **いま前面にある窓へ、ALT が 1 回入る** —— 検証中それは git-qa 自身の窓で、
/// 単独の ALT は何もしないが、**別の窓へ打ち込んでいることに変わりはない。**
///
/// **素で出られるときは、ここを通らない。**出られなかったときだけの最後の手段。
unsafe fn unlock_front() {
    let down = stroke(VK_MENU, false);
    let up = stroke(VK_MENU, true);
    SendInput(&[down, up], std::mem::size_of::<INPUT>() as i32);
    sleep(FRONT_STEP);
}

/// 相手を前面へ出す。**`SetForegroundWindow` だけでは効かないことがある。**
///
/// Windows は前面の奪い合いを制限していて、**入力を最後に受けたプロセスでないと
/// 前面に出せない。**実測（2026-09-14）: 背景の殻から起こした道具では、Chromium の窓を
/// 前面に出せず、**`SetForegroundWindow` は成功したように返って何も起きなかった。**
///
/// いま前面にある窓のスレッドへ**入力を結び付けてから**頼むと通る
/// （`AttachThreadInput`）。**結び付けたら必ず外す。**
///
/// **ここで出せなくても、送らない側で止める。**この関数は「出せるようにする」だけで、
/// 「出たかどうか」は呼んだ側が確かめる。
unsafe fn bring_to_front(hwnd: HWND, came_from: HWND) {
    let ours = GetCurrentThreadId();
    let theirs = if came_from.is_invalid() {
        0
    } else {
        GetWindowThreadProcessId(came_from, None)
    };

    let attached = theirs != 0 && theirs != ours && AttachThreadInput(ours, theirs, true).as_bool();

    let _ = SetForegroundWindow(hwnd);

    if attached {
        let _ = AttachThreadInput(ours, theirs, false);
    }
}

/// `Ctrl+Enter` のような書き方を、修飾キーと本体に分ける。
///
/// **知っている名前だけを受ける。**当てずっぽうで打つと、
/// **押したつもりで別の文字が入る**（macOS 側が踏んだのと同じ穴・`keys.ts`）。
fn parse(key: &str) -> Result<(Vec<VIRTUAL_KEY>, VIRTUAL_KEY), String> {
    let parts: Vec<&str> = key
        .split('+')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let Some((last, rest)) = parts.split_last() else {
        return Err("キーの名前が空".into());
    };

    let mut modifiers = Vec::new();
    for one in rest {
        modifiers.push(modifier(one).ok_or_else(|| format!("知らない修飾キー: {one}"))?);
    }

    let main = code(last)
        .ok_or_else(|| format!("知らないキー: {last}（当てずっぽうで打つと、別の文字が入ります）"))?;
    Ok((modifiers, main))
}

fn modifier(name: &str) -> Option<VIRTUAL_KEY> {
    match name.to_lowercase().as_str() {
        "ctrl" | "control" => Some(VK_CONTROL),
        "shift" => Some(VK_SHIFT),
        "alt" | "option" => Some(VK_MENU),
        "win" | "meta" => Some(VK_LWIN),
        _ => None,
    }
}

/// 本体のキー。**載っていない名前は断る。**
fn code(name: &str) -> Option<VIRTUAL_KEY> {
    let lower = name.to_lowercase();
    let named = match lower.as_str() {
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "escape" | "esc" => 0x1B,
        "left" | "arrowleft" => 0x25,
        "up" | "arrowup" => 0x26,
        "right" | "arrowright" => 0x27,
        "down" | "arrowdown" => 0x28,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        _ => 0,
    };
    if named != 0 {
        return Some(VIRTUAL_KEY(named));
    }

    // F1〜F12。
    if let Some(number) = lower.strip_prefix('f') {
        if let Ok(n) = number.parse::<u16>() {
            if (1..=12).contains(&n) {
                return Some(VIRTUAL_KEY(0x70 + n - 1));
            }
        }
    }

    // 英数字 1 文字。**2 文字以上は断る**（名前の綴り間違いを、文字入力にしない）。
    let mut chars = lower.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphabetic() => {
            Some(VIRTUAL_KEY(c.to_ascii_uppercase() as u16))
        }
        (Some(c), None) if c.is_ascii_digit() => Some(VIRTUAL_KEY(c as u16)),
        _ => None,
    }
}

/// 修飾キーを押しながら本体を押して、**押した逆順で離す。**
unsafe fn send(modifiers: &[VIRTUAL_KEY], main: VIRTUAL_KEY) {
    let mut events: Vec<INPUT> = Vec::new();
    for one in modifiers {
        events.push(stroke(*one, false));
    }
    events.push(stroke(main, false));
    events.push(stroke(main, true));
    for one in modifiers.iter().rev() {
        events.push(stroke(*one, true));
    }

    SendInput(&events, std::mem::size_of::<INPUT>() as i32);
}

fn stroke(key: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
