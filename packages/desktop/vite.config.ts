import { defineConfig } from 'vite';

export default defineConfig({
  // dist/ は lint・整形・Git のいずれからも外れている。成果物はその下へ入れる。
  build: { outDir: 'dist/web', emptyOutDir: true },
  // Tauri は決め打ちの URL を見に来るので、ポートが空いていなければ黙って別ポートへ
  // 逃げるのではなく落とす。
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
