import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Tauri の設定は JSON で、コードから型で守れない。**間違えると静かに壊れる**ので、
 * 壊れたら落ちるところだけをここに書く。
 */

const CONF = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));
const conf = JSON.parse(readFileSync(CONF, 'utf8')) as {
  app: { security: { csp: string | null }; windows: { minWidth?: number }[] };
  build: { frontendDist: string };
};

describe('tauri.conf.json', () => {
  it('CSP が空になっていない', () => {
    // null にすると何でも読み込める。**塞いだつもりで開いている**状態を作らない。
    expect(conf.app.security.csp).not.toBeNull();
  });

  it('ライブ映像の橋（loopback）へ繋げる', () => {
    // 橋は空いている口を OS に選ばせるので、port は決め打ちできない（C33）。
    // ここが 'self' だけだと、画面は vite の origin にいるので橋へ繋げず、
    // **映像が黙って出ない**（実際にこれで止まった）。
    const csp = conf.app.security.csp ?? '';
    expect(csp).toMatch(/connect-src[^;]*\bhttp:\/\/127\.0\.0\.1:\*/);
  });

  it('外へは出さない', () => {
    // loopback 以外を足さない。ここを流れるのは検証中の端末の画面（PRD §10）。
    const connectSrc = /connect-src([^;]*)/.exec(conf.app.security.csp ?? '')?.[1] ?? '';
    expect(connectSrc).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[^\s]+/);
  });

  it('配布物の置き場が Vite の出力と揃っている', () => {
    expect(conf.build.frontendDist).toBe('../dist/web');
  });
});
