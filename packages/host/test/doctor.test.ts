import { describe, expect, it } from 'vitest';

import {
  freshnessOf,
  PILLARS,
  parseIosDevices,
  type Probe,
  type ProbeResult,
  reportOf,
  verdictOf,
} from '../src/doctor.js';

/**
 * **各々の OS で開発していくために、要るのは共通の口**（2026-09-19・人の指示）。
 *
 * > 開発版としてプッシュして、win 側の開発動作確認を渡して各々の OS で開発していきましょう
 *
 * **「自分の機械では動いた」は、そのままでは他の人に渡せない。**
 * 何が在って何が無いかを**同じ形で**言えないと、
 * 「動かない」の原因が**機械の差なのか、こちらの不具合なのか**が分からない。
 *
 * **測って出す。見込みを書かない**（C56）。
 */
const ok = (name: string, detail: string): ProbeResult => ({ name, state: 'ok', detail });
const missing = (name: string, detail: string): ProbeResult => ({ name, state: 'missing', detail });

describe('verdictOf', () => {
  it('要るものが全部そろっていれば ok', () => {
    expect(verdictOf([ok('Node', 'v22'), ok('adb', '2 台')])).toBe('ok');
  });

  it('1 つでも欠けていれば missing', () => {
    expect(verdictOf([ok('Node', 'v22'), missing('adb', '入っていない')])).toBe('missing');
  });

  it('何も測れなかったら unknown（「全部だめ」と混ぜない）', () => {
    expect(verdictOf([])).toBe('unknown');
  });

  /**
   * **その OS に要らないものを「欠けている」と言わない**（2026-09-19・実測で踏んだ）。
   *
   * macOS で `git-qa-win`（Windows 用）が無いのは当たり前なのに、
   * **健全な機械が「欠けています」と出ていた。**
   * 毎回そう出ると、**人は読むのをやめる。**
   */
  it('その OS では要らないものは、欠けている数に入れない', () => {
    const skipped: ProbeResult = {
      name: 'git-qa-win',
      state: 'skip',
      detail: 'この OS では要りません',
    };

    expect(verdictOf([ok('Node', 'v22'), skipped])).toBe('ok');
  });
});

describe('reportOf', () => {
  const probes: readonly Probe[] = [
    { pillar: '見る', run: () => Promise.resolve(ok('adb', '1 台')) },
    { pillar: '押す', run: () => Promise.resolve(missing('git-qa-input', '建てていない')) },
  ];

  it('柱ごとに並べて出す（人が Issue へそのまま貼れる形）', async () => {
    const said = await reportOf(probes, { platform: 'darwin', release: 'dev' });

    expect(said).toContain('見る');
    expect(said).toContain('押す');
    expect(said).toContain('adb');
    expect(said).toContain('git-qa-input');
  });

  it('どの機械の話かが分かる（OS と版を必ず出す）', async () => {
    const said = await reportOf(probes, { platform: 'win32', release: 'v0.2.0-beta.14' });

    expect(said).toContain('win32');
    expect(said).toContain('v0.2.0-beta.14');
  });

  it('欠けているものは、見つけやすい印を付ける', async () => {
    const said = await reportOf(probes, { platform: 'darwin', release: 'dev' });

    expect(said).toMatch(/[✗×]|無い|入っていない/);
  });

  it('1 つが落ちても、残りは出す（測れないことと、機械が壊れていることは別）', async () => {
    const broken: readonly Probe[] = [
      {
        pillar: '見る',
        run: () => Promise.reject(new Error('EACCES')),
      },
      { pillar: '押す', run: () => Promise.resolve(ok('git-qa-input', '在る')) },
    ];

    const said = await reportOf(broken, { platform: 'darwin', release: 'dev' });

    expect(said).toContain('EACCES');
    expect(said).toContain('git-qa-input');
  });
});

describe('PILLARS', () => {
  it('この道具の柱は、見る・読む・押す・残す', () => {
    expect(PILLARS).toEqual(['見る', '読む', '押す', '残す']);
  });
});

/**
 * **iPhone は「まだ無い」のであって「未テスト」ではない**（2026-09-19）。
 *
 * ただし**挿したことには気づけるようにする** —— そこが測れないと、
 * 「見る」を作りにいく前の一歩目が踏めない（`.claude/issues/001`）。
 *
 * **`xctrace list devices` は使わない。**`== Devices Offline ==` の節を持っていて、
 * **見出しに「Devices」を含むので「つながっている」と数えてしまった**（2026-09-19・実測で発覚）。
 * しかも**この Mac 自身も並ぶ**ので、名前で除くのは当てにならない。
 *
 * **`devicectl list devices` は State を持っている。**そこを読む。
 */
describe('parseIosDevices', () => {
  const table = [
    'Devices:',
    'Name              Hostname             Identifier   State         Model',
    '---------------   ------------------   ----------   -----------   ----------------------',
    'めたの iPhone Xs   a.coredevice.local   AAAA         unavailable   iPhone XS (iPhone11,2)',
    'iPhone 13         b.coredevice.local   BBBB         connected     iPhone 13 (iPhone14,5)',
  ].join('\n');

  it('つながっている実機だけ数える（unavailable は数えない）', () => {
    expect(parseIosDevices(table)).toEqual(['iPhone 13 (iPhone14,5)']);
  });

  it('名前も識別子も残さない（機械と人を特定できる値を出さない）', () => {
    const said = parseIosDevices(table).join(' ');

    expect(said).not.toContain('めた');
    expect(said).not.toContain('coredevice');
    expect(said).not.toContain('BBBB');
  });

  it('1 台もつながっていなければ空（「測れなかった」と混ぜない）', () => {
    const none = [
      'Devices:',
      'Name        Hostname     Identifier   State         Model',
      '---------   ----------   ----------   -----------   ---------',
      'iPhone 13   b.local      BBBB         unavailable   iPhone 13',
    ].join('\n');

    expect(parseIosDevices(none)).toEqual([]);
  });

  /** **端末名は人が付ける。**日本語が入ると列の幅が崩れる（実測で踏んだ）。 */
  it('日本語の端末名でも読める（列の幅で切っていない）', () => {
    const said = parseIosDevices(
      'めたの あいふぉん   c.local   CCCC   connected   iPhone 15 Pro (iPhone16,1)',
    );

    expect(said).toEqual(['iPhone 15 Pro (iPhone16,1)']);
  });

  it('1 台も繋いだことが無いときの出力でも落ちない', () => {
    expect(parseIosDevices('No devices found.')).toEqual([]);
  });
});

/**
 * **この clone が、どれだけ古いか**（2026-09-21）。
 *
 * Windows の開発機の clone が **`beta.3` で止まっていた**（11 版・約 5 日）。
 * **誰も気づかなかった。**`beta.9` の Windows 起動修正すら入っておらず、
 * **配った版が 368ms で死ぬまま**だった。
 *
 * `docs/dev-check.md` に「まず `git pull`」と書いたが、
 * **手順書は実行者が飛ばせる。**測って出すほうにする。
 */
describe('freshnessOf', () => {
  it('追いついていれば、そう言う', () => {
    const said = freshnessOf({ behind: 0, fetchedDaysAgo: 0 });

    expect(said.state).toBe('ok');
  });

  it('遅れているなら、何コミット遅れているかを言う', () => {
    const said = freshnessOf({ behind: 11, fetchedDaysAgo: 0 });

    expect(said.state).toBe('missing');
    expect(said.detail).toContain('11');
  });

  /**
   * **取ってきていない clone は、遅れを 0 と答える。**
   * 「追いついている」と「確かめていない」を混ぜない。
   */
  it('長く取ってきていないなら、遅れが 0 でも信じない', () => {
    const said = freshnessOf({ behind: 0, fetchedDaysAgo: 5 });

    expect(said.state).toBe('missing');
    expect(said.detail).toContain('5');
  });

  it('上流が無い clone では、測れないと言う（落ちない）', () => {
    const said = freshnessOf({ behind: undefined, fetchedDaysAgo: 0 });

    expect(said.state).toBe('error');
  });
});
