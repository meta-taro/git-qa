//! 画面を触る道具（C57 追記・2026-09-07）。
//!
//! **前面に出さずに押すため**だけに在る。
//!
//! それまでは `System Events` の `click at {x, y}` で押していた。あれは画面の座標へ送るので、
//! 窓が隠れていると手前の別アプリが受け取る。避けるために毎回そのアプリを前面へ出していたが、
//! **人が判定を置くたび・押すたびに相手が一番上に来る**ことになり、
//! 掴んで運ぶ操作も原理的に作れなくなっていた。
//!
//! 試して駄目だったもの（**同じ道を二度試さないために残す**）:
//!
//! - `CGEventPostToPid` … 呼び出しはエラーを返さないのに、Chromium / Electron は受け取らない。
//!   **前面に出していても届かない。**JXA からでも Rust からでも同じだった
//!
//! 効いたもの: **アクセシビリティの要素を直接押す**（`AXUIElementPerformAction` / `AXPress`）。
//! 前面に出す必要が無く、隠れたままでも押せる。
//!
//! Windows へ持っていくときは、この実行ファイルの中身だけを差し替える
//! （`PostMessage(hwnd, WM_LBUTTONDOWN)` が同じ役をする）。**呼ぶ側の形は変えない。**

use std::ffi::{c_void, CStr, CString};

type Ref = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> Ref;
    fn AXUIElementCreateSystemWide() -> Ref;
    fn AXUIElementGetPid(el: Ref, out: *mut i32) -> i32;

    fn CGEventCreate(source: Ref) -> Ref;
    fn CGEventGetLocation(event: Ref) -> CGPoint;
    fn CGEventSetLocation(event: Ref, at: CGPoint);
    fn CGEventCreateScrollWheelEvent2(
        source: Ref,
        units: u32,
        wheels: u32,
        w1: i32,
        w2: i32,
        w3: i32,
    ) -> Ref;
    fn CGEventCreateMouseEvent(source: Ref, kind: u32, at: CGPoint, button: u32) -> Ref;
    fn CGEventPost(tap: u32, event: Ref);
    fn CGWarpMouseCursorPosition(at: CGPoint) -> i32;
    fn CGAssociateMouseAndMouseCursorPosition(connected: i32) -> i32;
    fn AXUIElementCopyElementAtPosition(app: Ref, x: f32, y: f32, out: *mut Ref) -> i32;
    fn AXUIElementCopyAttributeValue(el: Ref, attr: *const c_void, out: *mut Ref) -> i32;
    fn AXUIElementPerformAction(el: Ref, action: *const c_void) -> i32;
    fn AXUIElementSetAttributeValue(el: Ref, attr: *const c_void, value: *const c_void) -> i32;
    fn AXUIElementCopyActionNames(el: Ref, out: *mut Ref) -> i32;
    /// `AXPosition` / `AXSize` は CFString ではなく **AXValue** で返る。中身はこれで取り出す。
    fn AXValueGetValue(value: Ref, kind: u32, out: *mut c_void) -> bool;

    fn CFStringCreateWithCString(alloc: *const c_void, s: *const i8, enc: u32) -> *const c_void;
    fn CFStringGetCString(s: *const c_void, buf: *mut i8, size: isize, enc: u32) -> bool;
    fn CFArrayGetCount(a: Ref) -> isize;
    fn CFArrayGetValueAtIndex(a: Ref, i: isize) -> *const c_void;
    fn CFBooleanGetValue(b: *const c_void) -> bool;
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFRelease(cf: *const c_void);
}

const UTF8: u32 = 0x0800_0100;

unsafe fn cfstr(s: &str) -> *const c_void {
    let c = CString::new(s).expect("内部の固定文字列");
    CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8)
}

/// CFString を Rust の文字列にする。**`CFStringGetCStringPtr` は null を返すことがある**ので使わない。
unsafe fn read(s: *const c_void) -> String {
    if s.is_null() {
        return String::new();
    }
    let mut buf = vec![0i8; 1024];
    if CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, UTF8) {
        CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
    } else {
        String::new()
    }
}

/// その要素が持っている操作の名前。
unsafe fn actions_of(el: Ref) -> Vec<String> {
    let mut list: Ref = std::ptr::null_mut();
    if AXUIElementCopyActionNames(el, &mut list) != 0 || list.is_null() {
        return Vec::new();
    }
    let count = CFArrayGetCount(list);
    let mut out = Vec::new();
    for i in 0..count {
        out.push(read(CFArrayGetValueAtIndex(list, i)));
    }
    CFRelease(list as *const c_void);
    out
}

/// **中身を出してもらう。**Chromium は聞かれるまで木を作らない。
unsafe fn ask_for_content(app: Ref) {
    let yes = cfstr("AXManualAccessibility");
    // `kCFBooleanTrue` は定数なので、真を持つ値を作る代わりに属性へ真を入れる。
    // CFBoolean の生成 API は無いので、既知の真を借りる。
    let mut role: Ref = std::ptr::null_mut();
    let _ = AXUIElementCopyAttributeValue(app, cfstr("AXRole"), &mut role);
    // `AXUIElementSetAttributeValue` は CFTypeRef を取る。真は `kCFBooleanTrue`。
    extern "C" {
        static kCFBooleanTrue: *const c_void;
    }
    let _ = AXUIElementSetAttributeValue(app, yes, kCFBooleanTrue);
    let _ = CFBooleanGetValue; // 使わないが、真偽の読み取りが要るときのために残す
}

/// `kAXValueCGPointType` / `kAXValueCGSizeType`。**名前で引ける定数が無い**ので数で書く。
const POINT_KIND: u32 = 1;
const SIZE_KIND: u32 = 2;

/// 属性を 1 つ取る。**取れないときは空**（読めない部品 1 つで一覧ごと落とさない）。
unsafe fn attr(el: Ref, name: &str) -> Ref {
    let mut out: Ref = std::ptr::null_mut();
    if AXUIElementCopyAttributeValue(el, cfstr(name), &mut out) != 0 {
        return std::ptr::null_mut();
    }
    out
}

/// 文字の属性。**文字でないものは空**（`AXValue` には数や真偽も入る）。
unsafe fn text_attr(el: Ref, name: &str) -> String {
    let v = attr(el, name);
    if v.is_null() {
        return String::new();
    }
    let out = if CFGetTypeID(v as *const c_void) == CFStringGetTypeID() {
        read(v as *const c_void)
    } else {
        String::new()
    };
    CFRelease(v as *const c_void);
    out
}

/// 位置と大きさ。**片方でも取れなければ、その部品は触れないので出さない。**
unsafe fn frame_of(el: Ref) -> Option<(CGPoint, CGSize)> {
    let p = attr(el, "AXPosition");
    let s = attr(el, "AXSize");
    let mut point = CGPoint { x: 0.0, y: 0.0 };
    let mut size = CGSize { width: 0.0, height: 0.0 };
    let got = !p.is_null()
        && !s.is_null()
        && AXValueGetValue(p, POINT_KIND, &mut point as *mut CGPoint as *mut c_void)
        && AXValueGetValue(s, SIZE_KIND, &mut size as *mut CGSize as *mut c_void);
    if !p.is_null() {
        CFRelease(p as *const c_void);
    }
    if !s.is_null() {
        CFRelease(s as *const c_void);
    }
    if got {
        Some((point, size))
    } else {
        None
    }
}

/// 名前。**題 → 値 → 説明 → 役割の説明**の順に見る。
///
/// **この順番は JXA の道に合わせてある**（2026-09-15 に、4 つの属性を実物から出して確かめた）。
/// System Events の見せ方は、素の AX の属性と 1 対 1 ではない。
///
/// ```text
/// name        = AXTitle ?? 文字の AXValue      静的テキストは、ここで本文が出る
/// description = AXDescription ?? AXRoleDescription   窓のボタンは「close button」で出る
/// ```
///
/// 取り違えると**名前が丸ごと変わる。**最初は `AXDescription` だけを見て
/// 「group」「close button」しか名前を持たない部品を全部落とし、
/// 次に `AXRoleDescription` だけにしたら、今度は本文が「text」になった。
///
/// **2 つの道が違う名前を出すと、同じシートが機械によって通ったり落ちたりする。**
unsafe fn name_of(el: Ref) -> String {
    for key in ["AXTitle", "AXValue", "AXDescription", "AXRoleDescription"] {
        let said = text_attr(el, key);
        if !said.trim().is_empty() {
            return said;
        }
    }
    String::new()
}

/// 木を下りながら、触れる部品を並べる。
///
/// **深さの扱いを JXA の道と揃えてある** —— 子を持つ部品が深さを越えたら、
/// そこで打ち切って印を立てる。**「無い」と「届かなかった」を混ぜないため。**
unsafe fn walk(el: Ref, depth: u32, max: u32, out: &mut Vec<String>, cut: &mut bool) {
    let kids = attr(el, "AXChildren");
    if kids.is_null() {
        return;
    }
    let count = CFArrayGetCount(kids);
    if count == 0 {
        CFRelease(kids as *const c_void);
        return;
    }
    if depth > max {
        *cut = true;
        CFRelease(kids as *const c_void);
        return;
    }

    for i in 0..count {
        let kid = CFArrayGetValueAtIndex(kids, i) as Ref;
        if kid.is_null() {
            continue;
        }
        let name = name_of(kid);
        if !name.is_empty() {
            if let Some((p, s)) = frame_of(kid) {
                let role = text_attr(kid, "AXRole");
                // **タブ区切り。**改行を含む値が混ざると行が割れるので、空白へ畳む。
                let one = name.replace(['\n', '\r', '\t'], " ");
                out.push(format!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    role, one, p.x, p.y, s.width, s.height
                ));
            }
        }
        walk(kid, depth + 1, max, out, cut);
    }
    CFRelease(kids as *const c_void);
}

/// 深さで打ち切った印。**`ax.ts` の `DEPTH_CUT` と同じ文字列**（片方だけ変えない）。
const DEPTH_CUT: &str = "<深さで打ち切り>";

/// 窓 1 つ分の木を出す。**出す形は JXA の道と同じ**（読む側は 1 つで足りる）。
unsafe fn print_tree(pid: i32, max: u32) {
    let app = AXUIElementCreateApplication(pid);
    if app.is_null() {
        fail(&format!("プロセス {pid} に繋げない"));
    }
    ask_for_content(app);

    let windows = attr(app, "AXWindows");
    if windows.is_null() || CFArrayGetCount(windows) == 0 {
        // **窓が無いのは、落ちたのとは違う。**空を返して、呼ぶ側に決めさせる。
        return;
    }
    let win = CFArrayGetValueAtIndex(windows, 0) as Ref;

    let mut out: Vec<String> = Vec::new();
    let mut cut = false;
    walk(win, 0, max, &mut out, &mut cut);
    if cut {
        out.push(DEPTH_CUT.to_string());
    }
    println!("{}", out.join("\n"));
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

/**
指を元へ返す。

**返すだけでは足りない。**`CGWarpMouseCursorPosition` の後、macOS は
**0.25 秒ほど、実際のマウスの動きを画面の指に伝えない。**
人からはこう見える: 「ポインタが斜めにとばされるんですよね」。
`CGAssociateMouseAndMouseCursorPosition(1)` で、その場で繋ぎ直す。
*/
unsafe fn warp_back(to: CGPoint) {
    let _ = CGWarpMouseCursorPosition(to);
    let _ = CGAssociateMouseAndMouseCursorPosition(1);
}

/// いま指が居る場所。**返しに行くために覚える。**
unsafe fn cursor_now() -> CGPoint {
    let probe = CGEventCreate(std::ptr::null_mut());
    if probe.is_null() {
        return CGPoint { x: 0.0, y: 0.0 };
    }
    let at = CGEventGetLocation(probe);
    CFRelease(probe as *const c_void);
    at
}

/**
なぞる。**前面に出さない。指も動かさない。**

滑車の出来事は「いま指が乗っている窓」へ行くと思っていたが、
**出来事そのものに場所を書ける**（`CGEventSetLocation`）。
これで、隠れている窓でも、人のポインタを飛ばさずになぞれる（2026-09-07 実測）。
*/
unsafe fn scroll(x: f64, y: f64, lines: i32) {
    let was = cursor_now();

    // **指を運ばないと届かない。**出来事に場所を書くだけでは、窓が受け取らなかった（実測）。
    let at = CGPoint { x, y };
    let move_ev = CGEventCreateMouseEvent(std::ptr::null_mut(), 5, at, 0);
    if !move_ev.is_null() {
        CGEventPost(0, move_ev);
        CFRelease(move_ev as *const c_void);
    }
    std::thread::sleep(std::time::Duration::from_millis(15));

    // 1 = kCGScrollEventUnitLine
    let ev = CGEventCreateScrollWheelEvent2(std::ptr::null_mut(), 1, 1, lines, 0, 0);
    if ev.is_null() {
        fail("滑車の出来事を作れなかった");
    }
    CGEventSetLocation(ev, at);
    CGEventPost(0, ev);
    CFRelease(ev as *const c_void);

    // **人のポインタを飛ばしたままにしない。**
    // 早く返しすぎると、滑車が届く前に指が戻ってしまう（実測）。
    // **遅く返すほど、指が飛んで見える時間が延びる。**届く最短を探した結果がこれ。
    std::thread::sleep(std::time::Duration::from_millis(25));
    warp_back(was);
}

/**
掴んで運ぶ。**ここだけは前面に出す。**

押して離すまでが 1 つながりで、途中で焦点が動くと掴んだものが落ちる。
**指も実際に動く**（そういう操作なので避けられない）。**終わったら指を元へ返す。**
*/
unsafe fn drag(pid: i32, from: CGPoint, to: CGPoint) {
    let was_cursor = cursor_now();

    // 前に居たアプリを覚えて、終わったら返す。
    let system = AXUIElementCreateSystemWide();
    let mut focused: Ref = std::ptr::null_mut();
    let mut was_pid: i32 = 0;
    if AXUIElementCopyAttributeValue(system, cfstr("AXFocusedApplication"), &mut focused) == 0
        && !focused.is_null()
    {
        let _ = AXUIElementGetPid(focused, &mut was_pid);
    }

    extern "C" {
        static kCFBooleanTrue: *const c_void;
    }
    let app = AXUIElementCreateApplication(pid);
    let _ = AXUIElementSetAttributeValue(app, cfstr("AXFrontmost"), kCFBooleanTrue);
    std::thread::sleep(std::time::Duration::from_millis(120));

    let post = |kind: u32, at: CGPoint| {
        let ev = CGEventCreateMouseEvent(std::ptr::null_mut(), kind, at, 0);
        if !ev.is_null() {
            CGEventPost(0, ev);
            CFRelease(ev as *const c_void);
        }
    };

    // 5 = 動かす / 1 = 押す / 6 = 押したまま動かす / 2 = 離す
    post(5, from);
    std::thread::sleep(std::time::Duration::from_millis(40));
    post(1, from);
    std::thread::sleep(std::time::Duration::from_millis(80));
    // **一足飛びに運ばない。**途中の動きを見ている相手が、掴んだと気づかない。
    let steps = 12;
    for step in 1..=steps {
        let ratio = f64::from(step) / f64::from(steps);
        post(
            6,
            CGPoint {
                x: from.x + (to.x - from.x) * ratio,
                y: from.y + (to.y - from.y) * ratio,
            },
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    std::thread::sleep(std::time::Duration::from_millis(80));
    post(2, to);

    // **人のポインタを飛ばしたままにしない。**
    warp_back(was_cursor);
    if was_pid != 0 && was_pid != pid {
        let back = AXUIElementCreateApplication(was_pid);
        let _ = AXUIElementSetAttributeValue(back, cfstr("AXFrontmost"), kCFBooleanTrue);
    }
}

fn usage() -> ! {
    eprintln!("使い方:");
    eprintln!("  git-qa-input press  <プロセス番号> <x> <y>");
    eprintln!("  git-qa-input scroll <x> <y> <行数>");
    eprintln!("  git-qa-input drag   <プロセス番号> <x1> <y1> <x2> <y2>");
    eprintln!("  git-qa-input tree   <プロセス番号> [深さ]");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
    }

    if args[1] == "scroll" {
        if args.len() < 5 {
            usage();
        }
        let x: f64 = args[2].parse().unwrap_or_else(|_| fail("x が数ではない"));
        let y: f64 = args[3].parse().unwrap_or_else(|_| fail("y が数ではない"));
        let lines: i32 = args[4].parse().unwrap_or_else(|_| fail("行数が数ではない"));
        unsafe { scroll(x, y, lines) };
        println!("ok");
        return;
    }

    if args[1] == "tree" {
        if args.len() < 3 {
            usage();
        }
        let pid: i32 = args[2].parse().unwrap_or_else(|_| fail("プロセス番号が数ではない"));
        let max: u32 = args
            .get(3)
            .map(|v| v.parse().unwrap_or_else(|_| fail("深さが数ではない")))
            .unwrap_or(12);
        unsafe { print_tree(pid, max) };
        return;
    }

    if args[1] == "drag" {
        if args.len() < 7 {
            usage();
        }
        let pid: i32 = args[2].parse().unwrap_or_else(|_| fail("プロセス番号が数ではない"));
        let coords: Vec<f64> = args[3..7]
            .iter()
            .map(|v| v.parse().unwrap_or_else(|_| fail("座標が数ではない")))
            .collect();
        unsafe {
            drag(
                pid,
                CGPoint { x: coords[0], y: coords[1] },
                CGPoint { x: coords[2], y: coords[3] },
            );
        }
        println!("ok");
        return;
    }

    if args.len() < 5 || args[1] != "press" {
        usage();
    }
    let pid: i32 = args[2].parse().unwrap_or_else(|_| fail("プロセス番号が数ではない"));
    let x: f32 = args[3].parse().unwrap_or_else(|_| fail("x が数ではない"));
    let y: f32 = args[4].parse().unwrap_or_else(|_| fail("y が数ではない"));

    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            fail(&format!("プロセス {pid} に繋げない"));
        }
        ask_for_content(app);

        let mut el: Ref = std::ptr::null_mut();
        let found = AXUIElementCopyElementAtPosition(app, x, y, &mut el);
        if found != 0 || el.is_null() {
            // -25204 = そのアプリは応答していない / -25211 = 触る許可が無い
            fail(&format!("その場所に触れる部品が無い（コード {found}）"));
        }

        let names = actions_of(el);
        if !names.iter().any(|n| n == "AXPress") {
            let mut role: Ref = std::ptr::null_mut();
            let _ = AXUIElementCopyAttributeValue(el, cfstr("AXRole"), &mut role);
            fail(&format!(
                "その部品は押せない（{}／できること: {}）",
                read(role as *const c_void),
                if names.is_empty() { "無し".to_string() } else { names.join(" / ") }
            ));
        }

        let pressed = AXUIElementPerformAction(el, cfstr("AXPress"));
        if pressed != 0 {
            fail(&format!("押せなかった（コード {pressed}）"));
        }
        println!("ok");
    }
}
