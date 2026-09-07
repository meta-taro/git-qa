import { describe, expect, it } from 'vitest';

import { notFrontmost, occludedBy, parseTopWindow, topWindowScript } from '../src/window.js';

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
describe('topWindowScript', () => {
  it('座標を数として埋める（文字列を混ぜない）', () => {
    const script = topWindowScript(410, 124);

    expect(script).toContain('var wantX = 410;');
    expect(script).toContain('var wantY = 124;');
  });

  it('普通の窓だけを見る（メニューバー・Dock を掴まない）', () => {
    expect(topWindowScript(0, 0)).toContain('kCGWindowLayer === 0');
  });
});

describe('parseTopWindow', () => {
  it('窓番号と持ち主を読む', () => {
    expect(parseTopWindow('217, Electron')).toEqual({ id: 217, owner: 'Electron' });
  });

  it('持ち主の名前にカンマが入っていても落とさない', () => {
    expect(parseTopWindow('9, Adobe, Inc. Viewer')).toEqual({ id: 9, owner: 'Adobe, Inc. Viewer' });
  });

  it('何も無ければ undefined（当て推量で押さない）', () => {
    expect(parseTopWindow('missing value')).toBeUndefined();
    expect(parseTopWindow('')).toBeUndefined();
  });
});

describe('occludedBy', () => {
  it('その点の最前面が目的の窓なら、何も言わない', () => {
    expect(occludedBy(217, { id: 217, owner: 'Electron' }, 'Electron')).toBeUndefined();
  });

  it('別の窓が手前なら、誰が邪魔をしているかまで言う', () => {
    const message = occludedBy(217, { id: 9, owner: 'Google Chrome' }, 'Electron');

    expect(message).toContain('Google Chrome');
    expect(message).toContain('Electron');
    // **勝手に前面へ出さない。**人が別の窓へ打っている最中に奪う（2026-09-06 の指摘）。
    expect(message).toContain('前面');
  });

  it('その点に窓が 1 つも無いなら、押さない', () => {
    expect(occludedBy(217, undefined, 'Electron')).toContain('窓が無い');
  });
});

/**
 * **2026-09-07、実際に別のアプリを押してしまった。**
 *
 *   click at {1648, 300} → Google Chrome のツールバーのボタン
 *   click at {1400, 237} → warifu の窓
 *
 * どちらも、映像には連動くんが写ったまま起きた（撮るのは窓番号指定なので隠れても正しく写る）。
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
