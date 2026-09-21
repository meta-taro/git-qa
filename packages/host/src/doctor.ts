/**
 * **この機械で何ができるかを、測って出す**（2026-09-19・人の指示）。
 *
 * > 開発版としてプッシュして、win 側の開発動作確認を渡して各々の OS で開発していきましょう
 *
 * **「自分の機械では動いた」は、そのままでは他の人に渡せない。**
 * 何が在って何が無いかを**同じ形で**言えないと、「動かない」の原因が
 * **機械の差なのか、こちらの不具合なのか**が分からない。
 *
 * **見込みを書かない**（C56）。**実際に呼んで、返ってきたものを出す。**
 * 出す形は、そのまま Issue へ貼れるものにする。
 */

/** この道具の柱。**どれが欠けると何が止まるか**で分けてある。 */
export const PILLARS = ['見る', '読む', '押す', '残す'] as const;

export type Pillar = (typeof PILLARS)[number];

/**
 * `skip` = **その OS では要らない**（2026-09-19）。
 *
 * macOS で `git-qa-win`（Windows 用）が無いのは当たり前なのに、
 * **健全な機械が「欠けています」と出ていた。**毎回そう出ると、**人は読むのをやめる。**
 */
export type ProbeState = 'ok' | 'missing' | 'error' | 'skip';

export interface ProbeResult {
  readonly name: string;
  readonly state: ProbeState;
  /** **実際に返ってきたもの。**「動く見込み」ではなく、版や台数や理由を入れる。 */
  readonly detail: string;
}

export interface Probe {
  readonly pillar: Pillar;
  readonly run: () => Promise<ProbeResult>;
}

/** 全体の判定。**何も測れていないことを「全部だめ」と混ぜない。** */
export function verdictOf(results: readonly ProbeResult[]): ProbeState | 'unknown' {
  if (results.length === 0) return 'unknown';
  if (results.some((r) => r.state === 'error')) return 'error';
  // **その OS に要らないものは、欠けている数に入れない。**
  return results.some((r) => r.state === 'missing') ? 'missing' : 'ok';
}

const MARK: Readonly<Record<ProbeState, string>> = {
  ok: '✓',
  missing: '✗',
  error: '!',
  // **要らないものは、目に入れない。**✗ と並ぶと、欠けているように読める。
  skip: '–',
};

export interface ReportContext {
  readonly platform: string;
  /** この git-qa の名乗り（C70）。**どの版で測ったかが無いと、後から読めない。** */
  readonly release: string;
}

/**
 * 柱ごとに並べて出す。
 *
 * **1 つが落ちても、残りは出す** —— 測れないことと、機械が壊れていることは別。
 * 落ちた理由は**そのまま**載せる（握り潰すと、人が次に何をすればよいか分からない）。
 */
export async function reportOf(probes: readonly Probe[], context: ReportContext): Promise<string> {
  const done = await Promise.all(
    probes.map(async (probe) => {
      try {
        return { pillar: probe.pillar, result: await probe.run() };
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          pillar: probe.pillar,
          result: { name: '測れなかった', state: 'error' as const, detail },
        };
      }
    }),
  );

  const lines: string[] = [`git-qa の環境確認 — ${context.platform} / ${context.release}`, ''];

  for (const pillar of PILLARS) {
    const here = done.filter((d) => d.pillar === pillar);
    if (here.length === 0) continue;
    lines.push(`## ${pillar}`);
    for (const { result } of here) {
      lines.push(`${MARK[result.state]} ${result.name} — ${result.detail}`);
    }
    lines.push('');
  }

  const verdict = verdictOf(done.map((d) => d.result));
  lines.push(
    verdict === 'ok'
      ? '**この機械では、ひととおりそろっています。**'
      : '**欠けているものがあります。**上の ✗ と ! を、そのまま Issue へ貼ってください。',
  );
  return lines.join('\n');
}

/**
 * **繋がっている iPhone を数える**（`xcrun devicectl list devices` の表から）。
 *
 * **iOS のアダプタはまだ無い**（README の表・`.claude/issues/001`）。
 * それでも**挿したことに気づける**ようにしておく ——
 * 「見る」を作りにいく前の一歩目が、ここで踏めなくなるため。
 *
 * **`xctrace list devices` は使わない**（2026-09-19・実測で外した）。
 * あちらは `== Devices Offline ==` という節を持っていて、
 * **見出しが「Devices」を含むので、繋がっていない端末まで数えてしまう。**
 * しかも**この Mac 自身も並ぶ**ので、名前で除くのは当てにならない。
 *
 * **返すのは機種だけ。**名前・ホスト名・識別子は出さない
 * （公開の場へ貼る文字なので、人と機械を特定できる値を持たせない・§25）。
 *
 * **列の幅で切らない。**端末名は人が付けるので**日本語が入る**（実測で崩れた）。
 * **状態の語を探して、その後ろを機種とする。**
 */
export function parseIosDevices(stdout: string): string[] {
  /** `devicectl` が返す状態。**`unavailable` 以外は、いま触れる。** */
  const STATE = /\s(unavailable|available|connected|connecting|disconnected|paired)\s+(\S.*)$/;

  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    const matched = STATE.exec(line.trimEnd());
    if (matched === null) continue;
    const [, state, model] = matched;
    if (state === undefined || model === undefined) continue;
    if (state === 'unavailable' || state === 'disconnected') continue;
    out.push(model.trim());
  }
  return out;
}

/**
 * **この clone が、どれだけ古いか**（2026-09-21）。
 *
 * Windows の開発機の clone が **`beta.3` で止まっていた**（11 版・約 5 日）。
 * **誰も気づかなかった。**`beta.9` の Windows 起動修正すら入っておらず、
 * **配った版が 368ms で死ぬまま**だった。
 * その機械から返ってくる値は、**こちらでは使えない** —— 何を測っても、古いものの話になる。
 *
 * `docs/dev-check.md` に「まず `git pull`」と書いた。
 * **ただし手順書は、実行者が飛ばせる。**測って出すほうにする。
 *
 * **取ってきていない clone は、遅れを 0 と答える。**
 * だから**いつ取ってきたか**も一緒に見る ——
 * **「追いついている」と「確かめていない」を混ぜない。**
 */
export interface Freshness {
  /** 上流より何コミット遅れているか。**測れなければ `undefined`**（上流が無い）。 */
  readonly behind: number | undefined;
  /** 最後に取ってきてから何日たったか。 */
  readonly fetchedDaysAgo: number;
}

/** 取ってきていないと信じない日数。**1 日なら、まだその日の話。** */
const STALE_FETCH_DAYS = 2;

export function freshnessOf(at: Freshness): ProbeResult {
  const name = 'この clone の新しさ';
  if (at.behind === undefined) {
    return { name, state: 'error', detail: '上流が分からない（clone ではない / 上流が未設定）' };
  }
  if (at.behind > 0) {
    return {
      name,
      state: 'missing',
      detail: `${String(at.behind)} コミット遅れている（git pull --ff-only してから測ってください）`,
    };
  }
  if (at.fetchedDaysAgo >= STALE_FETCH_DAYS) {
    return {
      name,
      state: 'missing',
      detail: `${String(at.fetchedDaysAgo)} 日、取ってきていない（遅れ 0 は当てにならない。git pull --ff-only）`,
    };
  }
  return { name, state: 'ok', detail: '追いついている' };
}
