import type { TargetSession } from '../adapter/types.js';

/**
 * **共有の実機を、別の人が使い始めていないかを見張る**（C121）。
 *
 * 2026-11-12、別の席が同じ iPhone を使っている最中に、git-qa（WebDriverAgent）が
 * アプリを何度も前面へ出して、その作業を邪魔した。端末は 1 台を複数の席で使うことがある。
 *
 * **操作のあとに前面のアプリを覚え、次の操作の前にもう一度読む。違っていれば、
 * 誰かが端末を使い始めたと見て、触らずに止める**（判断保留で人へ渡す）。
 * 自分の操作で替わった分（起動・別アプリへ飛ぶリンク）は、操作のあとに覚えるので追い付く。
 *
 * **止めたあとも、覚えているものは替えない。**相手が使い終えて前面が戻れば次の操作へ進める。
 * 戻らないうちは、次の件でも触らない —— 人が使っているアプリの上で、こちらの手順を押さない。
 *
 * 前面を言えない相手（口の無いもの・ウェブ・デスクトップ）では何もしない。
 * 読めなかったことは「替わった」に混ぜない（見張りの失敗を、検証の失敗にしない）。
 */
export interface ForegroundGuard {
  /** 操作の前に読む。替わっていれば、止める理由を返す（返したら操作しない）。 */
  check(session: TargetSession, stepText: string): Promise<string | undefined>;
  /** 操作のあとに読んで覚える。自分の操作で替わった分は、ここで追い付く。 */
  remember(session: TargetSession): Promise<void>;
}

/** 替わっていたら、人に渡す理由。どちらかが読めなければ、替わったとは言わない。 */
export function foregroundChangeReason(
  stepText: string,
  before: string | undefined,
  now: string | undefined,
): string | undefined {
  if (before === undefined || now === undefined || before === now) return undefined;
  return (
    `「${stepText}」の前に、前面のアプリが替わっていた` +
    `（別の人が端末を使っているかもしれない）: ${before} → ${now}`
  );
}

/**
 * **始める前に、空いているかを見る**（C121 の 2 つ目）。
 *
 * まだ何も覚えていない最初の操作の前に、前面が検証する相手でもホーム画面でもなければ、
 * 誰かが使っている最中と見て始めない。相手を知らなければ見ない（途中の見張りだけ）。
 * ホームが分からない相手では、相手のアプリでなければ始めない（空いていると決めつけない）。
 */
export function busyBeforeStartReason(
  app: string | undefined,
  now: string | undefined,
  home: string | undefined,
): string | undefined {
  if (app === undefined || now === undefined) return undefined;
  if (now === app || (home !== undefined && now === home)) return undefined;
  return (
    `始める前に、前面に居るのが「${now}」で、検証する相手（${app}）でもホーム画面でもない` +
    `（別の人が端末を使っているかもしれない）。空いていることを確かめて、もう一度始める`
  );
}

/** 読めなければ `undefined`。**見張りの口が落ちても、操作は止めない。** */
const readForeground = async (session: TargetSession): Promise<string | undefined> => {
  try {
    return await session.foreground?.();
  } catch {
    return undefined;
  }
};

const readHome = async (session: TargetSession): Promise<string | undefined> => {
  try {
    return await session.homeApp?.();
  } catch {
    return undefined;
  }
};

export interface ForegroundGuardOptions {
  /** 検証する相手のアプリの識別子（シートの `# 対象:`）。無ければ、始める前の見張りはしない。 */
  readonly app?: string;
}

export function createForegroundGuard(options: ForegroundGuardOptions = {}): ForegroundGuard {
  /** 最後に見た前面のアプリ。件をまたいで持つ（人が判定を置いている間に替わるのを見るため）。 */
  let last: string | undefined;

  return {
    async check(session, stepText) {
      const now = await readForeground(session);
      if (last === undefined) {
        // **まだ何も覚えていない＝始める前。**空いていなければ始めず、覚えもしない（次の件でまた見る）。
        const busy = busyBeforeStartReason(options.app, now, await readHome(session));
        if (busy !== undefined) return busy;
        // 初めて見たとき（と、前が読めていなかったとき）は覚えるだけ。
        last = now;
        return undefined;
      }
      // 替わっていれば止める。**止めたときは覚えを替えない。**
      return foregroundChangeReason(stepText, last, now);
    },

    async remember(session) {
      // 読めなかったら忘れる。**読めなかった前と、読めた今を見比べて「替わった」と言わない。**
      last = await readForeground(session);
    },
  };
}
