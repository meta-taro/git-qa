//! 窓 1 つだけを撮る。
//!
//! macOS 側の `screencapture -l <窓番号>` に当たる。
//!
//! **`PrintWindow` を使う。**画面を撮って切り抜く方式だと、
//! **前に別の窓が重なっていると、その窓が写る。**
//! 検証の相手は後ろに置いたまま操作する（C57）ので、それでは使えない。
//!
//! `PW_RENDERFULLCONTENT`（2）は、**GPU で描いている窓**（Electron / Chromium 系）に要る。
//! 付けないと真っ白になる。

use std::path::Path;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
};
// `PrintWindow` は `Storage::Xps` に居る（印刷の仲間として並んでいる）。
use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

/// **GPU で描いている窓の中身まで写す**（Electron / Chromium 系に要る。付けないと真っ白）。
/// `windows` crate には `PW_CLIENTONLY` しか名前が無いので、ここで定める。
const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);

pub fn capture(hwnd: &str, out: &str) -> Result<String, String> {
    let hwnd = crate::parse_hwnd(hwnd)?;
    let (pixels, width, height) = pixels_of(hwnd)?;

    // `GetDIBits` は BGRA で返す。PNG は RGBA なので、青と赤を入れ替える。
    let mut rgba = Vec::with_capacity(pixels.len());
    for chunk in pixels.chunks_exact(4) {
        rgba.extend_from_slice(&[chunk[2], chunk[1], chunk[0], 255]);
    }

    image::save_buffer(
        Path::new(out),
        &rgba,
        width as u32,
        height as u32,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("絵を書けない（{out}）: {e}"))?;

    Ok(format!("{width}\t{height}\n"))
}

fn pixels_of(hwnd: HWND) -> Result<(Vec<u8>, i32, i32), String> {
    // SAFETY: 作った DC と bitmap は、返る前に必ず片付ける。
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).map_err(|e| format!("窓の大きさが取れない: {e}"))?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 1 || height < 1 {
            return Err(format!("窓の大きさが取れない: {width}x{height}"));
        }

        let screen = GetDC(None);
        let memory = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let old = SelectObject(memory, bitmap);

        let drew = PrintWindow(hwnd, memory, PW_RENDERFULLCONTENT).as_bool();

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // 負にすると上から下へ並ぶ（そのまま PNG にできる）。
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            memory,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );

        SelectObject(memory, old);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);

        if !drew {
            return Err("窓を撮れない（PrintWindow が断った）".into());
        }
        if lines == 0 {
            return Err("撮った絵を読み出せない（GetDIBits が 0 行）".into());
        }
        Ok((pixels, width, height))
    }
}
