//! 窓を探す・実行ファイルの場所を出す。
//!
//! macOS 側の `CGWindowListCopyWindowInfo` に当たる。**出す形は揃えてある**
//! （`hwnd \t pid \t exe \t title \t x \t y \t w \t h`）。

use std::path::Path;

use windows::core::PWSTR;
use windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM, MAX_PATH, RECT, TRUE};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    PROCESS_NAME_FORMAT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};

/// 見つけた窓 1 つ。
pub struct Seen {
    pub hwnd: isize,
    pub pid: u32,
    pub exe: String,
    pub title: String,
    pub rect: RECT,
}

/// **人が名乗る名前**で窓を探す。
///
/// macOS では「窓の持ち主のアプリ名」で探している。Windows に同じものは無いので、
/// **実行ファイルの名前（拡張子なし）と、窓の題の両方**を見る。
/// どちらかに当たれば拾う —— 人が `dbboard` と打つのか `DBBoard` と打つのかは、決められない。
pub fn list(app: &str) -> Result<String, String> {
    let want = app.to_lowercase();
    let mut out = String::new();

    for seen in all()? {
        let exe_stem = Path::new(&seen.exe)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !exe_stem.contains(&want) && !seen.title.to_lowercase().contains(&want) {
            continue;
        }
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            seen.hwnd,
            seen.pid,
            seen.exe,
            // 題に改行やタブが入ることがある。**1 行 1 件を壊さない。**
            seen.title.replace(['\t', '\n', '\r'], " "),
            seen.rect.left,
            seen.rect.top,
            seen.rect.right - seen.rect.left,
            seen.rect.bottom - seen.rect.top,
        ));
    }
    Ok(out)
}

/// 指紋のための実行ファイルの場所（macOS 側の `lsof -d txt` に当たる）。
pub fn exe_path(pid: &str) -> Result<String, String> {
    let pid: u32 = pid.parse().map_err(|_| format!("プロセス番号が数でない: {pid}"))?;
    Ok(format!("{}\n", exe_of(pid)?))
}

fn all() -> Result<Vec<Seen>, String> {
    let mut found: Vec<Seen> = Vec::new();
    let ptr = &mut found as *mut Vec<Seen> as isize;
    // SAFETY: `visit` は下で定義してあり、`LPARAM` には上の `Vec` だけを渡す。
    unsafe { EnumWindows(Some(visit), LPARAM(ptr)) }.map_err(|e| format!("窓を数えられない: {e}"))?;
    Ok(found)
}

unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> BOOL {
    let found = &mut *(param.0 as *mut Vec<Seen>);

    // 見えていない窓は数えない（人が見ているものだけを相手にする）。
    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }
    let length = GetWindowTextLengthW(hwnd);
    if length <= 0 {
        return TRUE;
    }
    let mut title = vec![0u16; length as usize + 1];
    let wrote = GetWindowTextW(hwnd, &mut title);
    let title = String::from_utf16_lossy(&title[..wrote as usize]);

    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return TRUE;
    }
    // 潰れている窓（大きさが無いもの）は、人が見ているものではない。
    if rect.right - rect.left < 2 || rect.bottom - rect.top < 2 {
        return TRUE;
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    found.push(Seen {
        hwnd: hwnd.0 as isize,
        pid,
        exe: exe_of(pid).unwrap_or_default(),
        title,
        rect,
    });
    TRUE
}

fn exe_of(pid: u32) -> Result<String, String> {
    // SAFETY: 開いた handle は必ず閉じる（下の `CloseHandle`）。
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| format!("プロセスを開けない（{pid}）: {e}"))?;
        let mut buffer = vec![0u16; MAX_PATH as usize];
        let mut size = buffer.len() as u32;
        let got = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        got.map_err(|e| format!("実行ファイルの場所が取れない（{pid}）: {e}"))?;
        Ok(String::from_utf16_lossy(&buffer[..size as usize]))
    }
}
