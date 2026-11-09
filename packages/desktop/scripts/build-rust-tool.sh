#!/usr/bin/env bash
# 画面を触る道具（Rust・`git-qa-input`）を建てる（macOS 専用）。
#
#   build-rust-tool.sh <Cargo.toml> <crate 名> <出力先>
#
# **両方の CPU 向けに建てて 1 本にする（universal）**（C115・2026-11-09）。
#
# `.dmg` を universal にしたのに、中の道具が arm64 だけなら、**Intel Mac では
# 「触れない」が静かに起きる**（Swift の道具で 2026-09-12 に踏んだのと同じ形）。
# `build-swift-tool.sh` と同じ作りにする —— 的ごとに建てて `lipo` で束ね、建てた直後に署名する。
#
# 的（`rustup target`）が入っていなければ、**どちらが建たなかったかを言って**残りで進む。
# どちらも建たなければ道具なしで 0 で返る（呼び側は `|| echo` で先へ進む前提）。
set -uo pipefail

manifest="${1:?使い方: build-rust-tool.sh <Cargo.toml> <crate 名> <出力先>}"
crate="${2:?使い方: build-rust-tool.sh <Cargo.toml> <crate 名> <出力先>}"
out="${3:?使い方: build-rust-tool.sh <Cargo.toml> <crate 名> <出力先>}"
target_dir="$(dirname "$manifest")/target"

built=()
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if cargo build --release --quiet --target "$target" --manifest-path "$manifest" 2>"$target_dir/$target.err"; then
    built+=("$target_dir/$target/release/$crate")
  else
    # **黙って片方だけにしない。**どちらが建たなかったかを言う（的が無いなら `rustup target add`）。
    echo "[git-qa] $crate を $target 向けに建てられない:"
    head -3 "$target_dir/$target.err"
  fi
done

if [ "${#built[@]}" -eq 0 ]; then
  echo "[git-qa] $crate を建てられない（この道具は無しで進む）"
  exit 0
fi

lipo -create "${built[@]}" -output "$out"
echo "[git-qa] $(basename "$out"): $(lipo -info "$out" | sed 's/.*are: //;s/.*is architecture: //')"

# **建てた直後に署名する。**別の段でまとめて署名すると、建て直しで署名が消える。
bash "$(dirname "$0")/sign-tool.sh" "$out"
