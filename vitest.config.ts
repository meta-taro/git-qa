import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // 実機に当てる検査は **1 台の端末を取り合う**。ファイルを並行させると、
    // 片方の操作がもう片方の uiautomator dump を壊す（実際に落ちた）。
    // 端末を使わない普段の実行では並行のままにする。
    fileParallelism: process.env['GIT_QA_ANDROID_E2E'] !== '1',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
