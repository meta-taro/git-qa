import { describe, expect, it } from 'vitest';

import { notFrontmost } from '../src/window.js';

/**
 * **2026-09-07 に気づいた。**
 *
 * 撮るほうは `screencapture -l <窓番号>` なので、手前に何が重なっていても
 * 目的の窓だけが写る（2026-09-04 に直した）。
 * **ところが押すほうは画面全体の座標で送っていた。**
 *
 * 窓が隠れていると、押した先は手前の別アプリになる。
 * そのとき出るのは「押せなかった」ではなく **PASS でも FAIL でもない別の何か**で、
 * 最悪、手前のブラウザのボタンを押す。**同じ間違いを 2 度やらない。**
 */

/**
 * **2026-09-07、実際に別のアプリを押してしまった。**
 *
 *   click at {1648, 300} → Google Chrome のツールバーのボタン
 *   click at {1400, 237} → warifu の窓
 *
 * どちらも、映像には相手のアプリが写ったまま起きた（撮るのは窓番号指定なので隠れても正しく写る）。
 * **窓の一覧で「手前」を確かめるだけでは足りない** —— 押した拍子に並び順が変わるし、
 * System Events の当たり判定と窓の一覧は、いつも同じ答えを返すわけではなかった。
 *
 * **押す前に、そのアプリを前面に出す。**出たことを確かめてから押す。
 */
describe('notFrontmost', () => {
  it('目的のアプリが前面なら、何も言わない', () => {
    expect(notFrontmost('Electron', 'Electron')).toBeUndefined();
  });

  it('別のアプリが前面なら、誰が前に居るかを言う', () => {
    const message = notFrontmost('Electron', 'Google Chrome');

    expect(message).toContain('Google Chrome');
    expect(message).toContain('Electron');
  });

  it('前面が分からなければ、押さない', () => {
    expect(notFrontmost('Electron', '')).toContain('分からない');
  });
});
