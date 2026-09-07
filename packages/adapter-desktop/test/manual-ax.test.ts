import { describe, expect, it } from 'vitest';

import { manualAccessibilityScript } from '../src/ax.js';

/**
 * **2026-09-07、連動くん（Electron）で丸一時間つまずいた所。**
 *
 * Electron / Chromium は、**支援技術に聞かれるまで中身を出さない。**
 * 出していない間はこうなる。
 *
 * - 段 1（AX）は `group` が 11 個だけで、文字が 1 つも取れない
 * - **押すと `-25211`（補助アクセスは許可されません）**。
 *   許可はあるのに、この文言で返る。**原因の見当がまるで違う方へ向く**
 *
 * `AXManualAccessibility` を立てると、その場で木が生えて、押せるようになった。
 */
describe('manualAccessibilityScript', () => {
  it('アプリ名を埋め込まずに閉じる（日本語の名前も落とさない）', () => {
    const script = manualAccessibilityScript('ローカル連動くん');

    expect(script).toContain('"ローカル連動くん"');
    expect(script).toContain('AXManualAccessibility');
  });

  it('引用符を含む名前でも壊れない', () => {
    expect(manualAccessibilityScript('a"b')).toContain(String.raw`"a\"b"`);
  });
});
