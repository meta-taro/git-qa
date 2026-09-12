import { defineConfig } from 'vite';

export default defineConfig({
  // dist/ は lint・整形・Git のいずれからも外れている。成果物はその下へ入れる。
  build: { outDir: 'dist/web', emptyOutDir: true },
  // Tauri は決め打ちの URL を見に来るので、ポートが空いていなければ黙って別ポートへ
  // 逃げるのではなく落とす。
  server: {
    port: 1420,
    strictPort: true,
    /**
     * **Rust の建てた先を見張らない**（2026-09-12・Windows 機で実測して足した）。
     *
     * `tauri dev` は、この開発サーバを起こしてから Rust を建てる。監視が
     * `src-tauri/target` に入ると、**書き込み中の `.dll` を掴んで落ちる。**
     *
     * ```text
     * code: 'EBUSY', syscall: 'watch',
     * path: 'packages\src-tauri\target\debug\deps\displaydoc-….dll'
     * Error The "beforeDevCommand" terminated with a non-zero status code.
     * ```
     *
     * macOS では同じ掴み方をしないので、**これまで誰も踏んでいなかった。**
     * そもそも成果物は人が書くものではなく、見張る理由が無い。
     */
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
});
