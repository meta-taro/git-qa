#!/usr/bin/env bash
# 同梱する道具 1 本に署名する（macOS）。
#
#   sign-tool.sh <実行ファイル>
#
# **`APPLE_SIGNING_IDENTITY` が無ければ何もしない。**手元で建てるときは ad-hoc のまま。
#
# **建てた直後に署名する。**別の段でまとめて署名すると、
# `tauri build` が `bundle:host` を走らせて**建て直し、署名を消す**
# （2026-09-12 に公証で弾かれて分かった）。
#
#   The signature does not include a secure timestamp.
#   The executable does not have the hardened runtime enabled.
#
# **公証は、中の実行ファイルが 1 つでも条件を外すと通らない。**
#   --options runtime … hardened runtime を有効にする
#   --timestamp       … 安全なタイムスタンプを付ける（証明書が切れても署名が生き続ける）
set -euo pipefail

target="${1:?使い方: sign-tool.sh <実行ファイル>}"

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "[git-qa] $(basename "$target"): 署名しない（材料が無い）"
  exit 0
fi

codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$target"

# **署名されたことを確かめる。**握り潰さない —— adhoc のままなら、公証で初めて落ちる。
if codesign -dv "$target" 2>&1 | grep -q 'Signature=adhoc'; then
  echo "[git-qa] $(basename "$target") が adhoc のままです（署名できていません）" >&2
  exit 1
fi
echo "[git-qa] $(basename "$target"): 署名した"
