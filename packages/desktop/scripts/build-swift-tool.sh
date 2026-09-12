#!/usr/bin/env bash
# 画面を読む・窓を録る道具を建てる（macOS 専用）。
#
#   build-swift-tool.sh <ソース.swift> <出力先>
#
# **両方の CPU 向けに建てて 1 本にする（universal）。**
#
# 2026-09-12 に配る直前で気づいた。`.dmg` は aarch64 なのに、中の道具が **x86_64** だった。
#
#   git-qa-input    arm64     ← cargo は正しく建てていた
#   git-qa-ocr      x86_64    ← swiftc は「いまの殻の CPU」に合わせる
#   git-qa-record   x86_64
#
# この端末の Terminal が Rosetta の下で動いているため、`swiftc` が x86_64 を選んでいた。
# **手元では動く**（Rosetta がある）。**Rosetta を入れていない Mac では動かない** ——
# 文字が読めず、録画もできない。**しかもエラーではなく「できない」として出る。**
#
# **建てる機械の事情を、配るものに持ち込まない。**
#
# 建てられない環境（Linux / Windows / Xcode 無し）では、**何もせずに 0 で返る。**
# 呼び側はその前提で組んである（`|| echo` で先へ進む）。
set -uo pipefail

src="${1:?使い方: build-swift-tool.sh <ソース.swift> <出力先>}"
out="${2:?使い方: build-swift-tool.sh <ソース.swift> <出力先>}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

built=()
for arch in arm64 x86_64; do
  if xcrun swiftc -O -target "${arch}-apple-macos13" "$src" -o "$tmp/$arch" 2>"$tmp/$arch.err"; then
    built+=("$tmp/$arch")
  else
    # **黙って片方だけにしない。**どちらが建たなかったかを言う。
    echo "[git-qa] $(basename "$src") を $arch 向けに建てられない:"
    head -3 "$tmp/$arch.err"
  fi
done

if [ "${#built[@]}" -eq 0 ]; then
  echo "[git-qa] $(basename "$src") を建てられない（この道具は無しで進む）"
  exit 0
fi

lipo -create "${built[@]}" -output "$out"
echo "[git-qa] $(basename "$out"): $(lipo -info "$out" | sed 's/.*are: //;s/.*is architecture: //')"
