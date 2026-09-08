// 画面の絵から文字を読む。**OS が持っている Vision を呼ぶだけ**（外部の依存を足さない）。
// 使い方: ocr <画像> → 「文字<TAB>x<TAB>y」を 1 行ずつ出す（座標は画像の左上を原点とした画素）。
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("絵を読めない\n".data(using: .utf8)!)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["ja-JP", "en-US"]
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])

let width = CGFloat(cg.width)
let height = CGFloat(cg.height)
for observation in (request.results ?? []) {
    guard let best = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox
    // Vision は左下を原点とした 0..1 で返す。画素に直し、上下を反転する。
    let x = Int((box.midX) * width)
    let y = Int((1 - box.midY) * height)
    // **大きさも返す。**指す矢印を文字の外へ置くのに要る
    // （2026-09-08「カレンダーならかぶっちゃだめでしょ」）。
    let w = Int(box.width * width)
    let h = Int(box.height * height)
    print("\(best.string)\t\(x)\t\(y)\t\(w)\t\(h)")
}
