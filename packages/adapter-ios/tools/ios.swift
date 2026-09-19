// iPhone / iPad の画面を、USB 越しに映す道具（2026-09-19・人の指示）。
//
// > Android を接続して検証録画できるように、iPhone,iPad の検証録画も必要です
//
//   git-qa-ios devices                 つながっている端末を並べる
//   git-qa-ios shoot <識別子> <出力.jpg>  1 枚撮る
//   git-qa-ios stream <識別子>           撮り続けて標準出力へ流す
//
// **押す口はここに無い。**iOS を押すには端末側にアプリ（WebDriverAgent）が要り、
// **署名が要る＝人の作業**（product-baseline §14）。**見る・読むだけを持つ。**
//
// **まだ実機で測っていない**（2026-09-19 時点・C56）。建つことだけ確かめてある。
//
// ## なぜ AVFoundation なのか
//
// macOS は **USB で繋いだ iPhone / iPad を「撮影機器」として見せる**（QuickTime の
// 「ムービー収録」でカメラに iPhone が並ぶのと同じ道）。**端末に何も入れずに映せる。**
//
// ただし**既定では一覧に出てこない。**CoreMediaIO に
// `kCMIOHardwarePropertyAllowScreenCaptureDevices` を立てて初めて現れる。
//
// ## 流し方
//
// **1 枚ごとに、長さを先に書いてから中身を書く**（`ライブ映像` と同じ扱いにするため）。
//
//     <10 進の長さ>\n<JPEG のバイト列>
//
// **境界を探させない。**JPEG の中に区切り文字が出ても壊れない形にしてある。

import AVFoundation
import CoreImage
import CoreMediaIO
import Foundation

/// **一覧に出てこない端末を、出てくるようにする。**
///
/// これを立てないと `AVCaptureDevice` の探索に iPhone / iPad が並ばない。
/// **立てても、端末側で「このコンピュータを信頼」が済んでいないと出てこない**
/// （人の操作。こちらからはできない）。
func allowScreenCaptureDevices() {
  var address = CMIOObjectPropertyAddress(
    mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
    mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
    mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
  )
  var yes: UInt32 = 1
  let size = UInt32(MemoryLayout.size(ofValue: yes))
  let status = CMIOObjectSetPropertyData(
    CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, size, &yes)
  if status != 0 {
    // **黙って空の一覧を返さない。**なぜ端末が出てこないのかが分からなくなる。
    FileHandle.standardError.write(
      "[git-qa] 撮影機器の開放に失敗した（コード \(status)）\n".data(using: .utf8)!)
  }
}

/// 映せる端末。**iPhone / iPad は「muxed」（映像と音が 1 本）として現れる。**
func captureDevices() -> [AVCaptureDevice] {
  allowScreenCaptureDevices()
  // **少し待つ。**開放した直後は、まだ一覧に載っていないことがある。
  Thread.sleep(forTimeInterval: 0.6)

  // **`.external` は macOS 14 以降**（2026-09-19・建てて分かった）。
  // 共通の建て方は macOS 13 向けなので、**古い名前も持っておく。**
  // 名前が変わっただけで、指しているものは同じ。
  let types: [AVCaptureDevice.DeviceType]
  if #available(macOS 14.0, *) {
    types = [.external]
  } else {
    types = [.externalUnknown]
  }

  let session = AVCaptureDevice.DiscoverySession(
    deviceTypes: types,
    mediaType: .muxed,
    position: .unspecified
  )
  return session.devices
}

func fail(_ said: String) -> Never {
  FileHandle.standardError.write("[git-qa] \(said)\n".data(using: .utf8)!)
  exit(1)
}

func device(matching wanted: String) -> AVCaptureDevice {
  let all = captureDevices()
  if all.isEmpty {
    fail(
      "映せる端末が無い（USB で繋ぎ、端末側で「このコンピュータを信頼」を済ませてください）")
  }
  if wanted == "-" { return all[0] }
  guard let found = all.first(where: { $0.uniqueID == wanted || $0.localizedName == wanted }) else {
    fail("その端末が見つからない: \(wanted)")
  }
  return found
}

/// 撮った 1 枚を JPEG にする。
func jpeg(from sample: CMSampleBuffer, quality: CGFloat) -> Data? {
  guard let pixels = CMSampleBufferGetImageBuffer(sample) else { return nil }
  let image = CIImage(cvPixelBuffer: pixels)
  let context = CIContext()
  guard let space = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
  return context.jpegRepresentation(
    of: image, colorSpace: space, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality])
}

/// 流れてくる絵を受ける。**受けた所で書く**（溜めない）。
final class Frames: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let onFrame: (Data) -> Void
  private let quality: CGFloat
  /// **1 枚だけ欲しいとき**に立てる。
  private let once: Bool
  private var done = false

  init(quality: CGFloat, once: Bool, onFrame: @escaping (Data) -> Void) {
    self.quality = quality
    self.once = once
    self.onFrame = onFrame
  }

  func captureOutput(
    _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if done { return }
    guard let data = jpeg(from: sampleBuffer, quality: quality) else { return }
    onFrame(data)
    if once {
      done = true
      exit(0)
    }
  }
}

func session(for device: AVCaptureDevice, delegate: Frames) -> AVCaptureSession {
  let session = AVCaptureSession()
  session.beginConfiguration()
  guard let input = try? AVCaptureDeviceInput(device: device) else {
    fail("端末を開けない（他のアプリ（QuickTime 等）が掴んでいませんか）")
  }
  guard session.canAddInput(input) else { fail("端末を入口に足せない") }
  session.addInput(input)

  let output = AVCaptureVideoDataOutput()
  output.alwaysDiscardsLateVideoFrames = true
  output.setSampleBufferDelegate(delegate, queue: DispatchQueue(label: "git-qa.ios.frames"))
  guard session.canAddOutput(output) else { fail("出口を足せない") }
  session.addOutput(output)

  session.commitConfiguration()
  return session
}

let args = CommandLine.arguments

func usage() -> Never {
  FileHandle.standardError.write(
    """
    使い方:
      git-qa-ios devices                      つながっている端末を並べる
      git-qa-ios shoot  <識別子|-> <出力.jpg>   1 枚撮る
      git-qa-ios stream <識別子|->             撮り続けて標準出力へ流す

    識別子に `-` を渡すと、最初に見つかった端末を使う。
    **押す口はありません**（WebDriverAgent が要る＝署名が要る＝人の作業）。

    """.data(using: .utf8)!)
  exit(2)
}

guard args.count >= 2 else { usage() }

switch args[1] {
case "devices":
  // **識別子 \t 名前 \t 機種** の 1 行 1 台。**名前は人が付けるので、そのまま出す側で扱う。**
  for found in captureDevices() {
    print("\(found.uniqueID)\t\(found.localizedName)\t\(found.modelID)")
  }

case "shoot":
  guard args.count >= 4 else { usage() }
  let target = device(matching: args[2])
  let path = args[3]
  let frames = Frames(quality: 0.8, once: true) { data in
    do {
      try data.write(to: URL(fileURLWithPath: path))
      print("ok")
    } catch {
      FileHandle.standardError.write("[git-qa] 書けなかった: \(error)\n".data(using: .utf8)!)
      exit(1)
    }
  }
  let live = session(for: target, delegate: frames)
  live.startRunning()
  // **永久には待たない。**繋がっているのに 1 枚も来ないことがある（信頼が済んでいない等）。
  DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
    fail("10 秒待って 1 枚も来なかった（端末側で「このコンピュータを信頼」を済ませてください）")
  }
  RunLoop.main.run()

case "stream":
  guard args.count >= 3 else { usage() }
  let target = device(matching: args[2])
  let out = FileHandle.standardOutput
  let frames = Frames(quality: 0.7, once: false) { data in
    // **長さを先に書く。**境界を探させない（JPEG の中に区切りが出ても壊れない）。
    out.write("\(data.count)\n".data(using: .utf8)!)
    out.write(data)
  }
  let live = session(for: target, delegate: frames)
  live.startRunning()
  RunLoop.main.run()

default:
  usage()
}
