fn main() {
  // **版の名乗りは `option_env!` で焼き付く**（`lib.rs` の `release`）。
  // これが無いと、タグを渡しても**前に建てたものがそのまま使われる** ——
  // 建て直したつもりで古い名乗りが配られる、いちばん気づきにくい壊れ方になる。
  println!("cargo:rerun-if-env-changed=GIT_QA_RELEASE");
  tauri_build::build()
}
