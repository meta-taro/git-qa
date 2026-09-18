import { describe, expect, it } from 'vitest';

import { RUNNER_NAME, runnerOf } from '../src/release.js';

/**
 * **どの版を使っているか、本人にも分からなかった**（2026-09-18）。
 *
 * `beta.3` も `beta.12` も、名乗りは `0.2.0` のままだった。
 * 版が残らないと、**直っているはずの不具合が直っていない**という話が噛み合わない
 * （試験導入先で実際に起きた —— `beta.8` で直したはずのものが効いていなかった）。
 *
 * **インストーラの版番号は数字のままにする**（`0.2.0`）。
 * MSI は `major.minor.patch` しか受け取らないので、そこを触ると Windows が壊れる。
 * **名乗りだけをタグにする。**
 */
describe('runnerOf', () => {
  it('配った版は、タグをそのまま名乗る', () => {
    expect(runnerOf({ GIT_QA_RELEASE: 'v0.2.0-beta.12' })).toEqual({
      name: RUNNER_NAME,
      version: 'v0.2.0-beta.12',
    });
  });

  it('手元で建てたものは dev と名乗る（配ったものと混ぜない）', () => {
    expect(runnerOf({}).version).toBe('dev');
  });

  it('空文字は「無い」と同じに扱う（CI が空の変数を渡してくることがある）', () => {
    expect(runnerOf({ GIT_QA_RELEASE: '   ' }).version).toBe('dev');
  });

  it('前後の空白は落とす', () => {
    expect(runnerOf({ GIT_QA_RELEASE: ' v0.2.0-beta.12\n' }).version).toBe('v0.2.0-beta.12');
  });
});
