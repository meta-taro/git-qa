// 窓 1 つを録る道具（2026-09-11・人の判断で「git-qa の窓を録る」を選んだ）。
//
// **相手のアプリではなく、git-qa の窓を録る。**そこには人が見たものが全部入っている
// —— ライブ映像、どのケースを判定していたか、AI が何と言ったか、矢印がどこを指していたか。
//
//   git-qa-record <窓番号> <出力先.mov>
//
// 止め方は **SIGINT / SIGTERM**。受けたら書き終えてから終わる（途中で切ると壊れた動画が残る）。
//
// `screencapture` の動画は画面か選択範囲で、**窓を指定できない**（実測）。
// なので ScreenCaptureKit を使う。macOS 12.3 以降。

import AVFoundation
import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

// **窓サーバへ繋いでから ScreenCaptureKit を触る。**
//
// これが無いと、窓の一覧を取ろうとした時点でこう落ちる（2026-09-11 実測）。
//
//     Assertion failed: (did_initialize), function CGS_REQUIRE_INIT,
//     file CGInitialization.c, line 44.
//
// **1 枚も撮らずに死ぬので、録画が「対応していない」ように見える。**
// 端末から叩く道具は、既定では窓サーバへ繋がない。ここで繋ぐ。
_ = NSApplication.shared

let args = CommandLine.arguments
guard args.count >= 3, let windowId = UInt32(args[1]) else {
    FileHandle.standardError.write("使い方: git-qa-record <窓番号> <出力先.mov>\n".data(using: .utf8)!)
    exit(2)
}
let outputPath = args[2]

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

/// 書き出す先。**既にあるなら触らない**（前の証跡を黙って消さない）。
if FileManager.default.fileExists(atPath: outputPath) {
    fail("既にある動画を上書きしようとした: \(outputPath)")
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private var started = false
    private let lock = NSLock()
    private var finished = false
    private var startedAt = CFAbsoluteTimeGetCurrent()

    /**
     * **最後に届いた絵。**
     *
     * ScreenCaptureKit は「変わっていない」ときにも枠を送ってくるが、
     * **その枠は絵を持っていない。**動きの無い窓では、4 秒で 61 枠のうち
     * 絵つきが 1 枚しか無かった（2026-09-11 実測）。
     *
     * 絵の無い枠を捨てるだけだと、**止まっている間の時間が動画から消える。**
     * 判定を置くために人が手を止めている時間は、まさにそこ。
     * だから**同じ絵をもう 1 枚置いて、時間を繋ぐ。**
     */
    private var last: CVPixelBuffer?

    init(url: URL, width: Int, height: Int) throws {
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
            ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input, sourcePixelBufferAttributes: nil)
        guard writer.canAdd(input) else { throw NSError(domain: "git-qa", code: 1) }
        writer.add(input)
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType
    ) {
        guard type == .screen, buffer.isValid else { return }

        lock.lock()
        defer { lock.unlock() }
        if finished { return }

        if let image = CMSampleBufferGetImageBuffer(buffer) {
            last = image
        }
        // 絵がまだ 1 枚も来ていないなら、置くものが無い。時計も始めない。
        guard let image = last else { return }

        if !started {
            guard writer.startWriting() else { return }
            writer.startSession(atSourceTime: .zero)
            startedAt = CFAbsoluteTimeGetCurrent()
            started = true
        }
        guard input.isReadyForMoreMediaData else { return }

        // **時刻は実時計で測る。**枠の時刻をそのまま使うと、
        // 絵を持ち回した枠の時刻が前後して、置けない枠が出る。
        let at = CMTime(
            seconds: CFAbsoluteTimeGetCurrent() - startedAt, preferredTimescale: 600)
        adaptor.append(image, withPresentationTime: at)
    }

    /// **書き終えてから終わる。**途中で切ると壊れた動画が残る。
    func finish(_ done: @escaping () -> Void) {
        lock.lock()
        if finished || !started {
            finished = true
            lock.unlock()
            done()
            return
        }
        finished = true
        lock.unlock()
        input.markAsFinished()
        writer.finishWriting(completionHandler: done)
    }
}

let ready = DispatchSemaphore(value: 0)
var recorder: Recorder?
var stream: SCStream?

SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
    guard let content else {
        fail("窓の一覧を取れなかった: \(error?.localizedDescription ?? "理由が返らない")")
    }
    guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
        fail("その窓が見つからない: \(windowId)")
    }

    let width = Int(window.frame.width)
    let height = Int(window.frame.height)
    guard width > 1, height > 1 else { fail("窓の大きさが取れない: \(width)x\(height)") }

    let config = SCStreamConfiguration()
    // 偶数に丸める。H.264 は奇数の幅・高さを受け取らない。
    config.width = width - (width % 2)
    config.height = height - (height % 2)
    config.minimumFrameInterval = CMTime(value: 1, timescale: 15)
    config.showsCursor = true
    config.scalesToFit = true

    do {
        let made = try Recorder(
            url: URL(fileURLWithPath: outputPath), width: config.width, height: config.height)
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let created = SCStream(filter: filter, configuration: config, delegate: made)
        try created.addStreamOutput(
            made, type: .screen, sampleHandlerQueue: DispatchQueue(label: "git-qa.record"))
        created.startCapture { error in
            if let error { fail("録画を始められなかった: \(error.localizedDescription)") }
            ready.signal()
        }
        recorder = made
        stream = created
    } catch {
        fail("録画の用意ができなかった: \(error.localizedDescription)")
    }
}

if ready.wait(timeout: .now() + 10) == .timedOut {
    fail("録画が始まらなかった（10 秒待った）")
}
// **始まったことを、呼び側へ知らせる。**これが出るまで待てば、取りこぼさない。
print("started")
fflush(stdout)

let stopping = DispatchSemaphore(value: 0)
func stop() {
    stream?.stopCapture { _ in
        recorder?.finish { stopping.signal() }
    }
}

/**
 * **止めてくれと言われたら、書き終えてから終わる。**
 *
 * 見張りは**主線ではない列**に置く。`.main` に置くと 1 度も動かなかった
 * （2026-09-11 実測。`NSApplication` を作った後の `RunLoop.main.run()` では、
 * 主列が回らないことがある）。**動かないと、書き終える前に殺される。**
 * そのときに残るのは、**moov atom を持たない・開けない動画**だった。
 */
let watching = DispatchQueue(label: "git-qa.record.signal")
var sources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    let source = DispatchSource.makeSignalSource(signal: sig, queue: watching)
    source.setEventHandler { stop() }
    source.resume()
    // 見張りへ渡すので、既定の「即死ぬ」ほうは黙らせる。
    signal(sig, SIG_IGN)
    // **持っておく。**捨てると見張りごと消える。
    sources.append(source)
}

DispatchQueue.global().async {
    if stopping.wait(timeout: .distantFuture) == .success {
        print("ok")
        exit(0)
    }
}

RunLoop.main.run()
