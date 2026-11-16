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

/** 読めなければ `undefined`。**見張りの口が落ちても、操作は止めない。** */
const readForeground = async (session: TargetSession): Promise<string | undefined> => {
  try {
    return await session.foreground?.();
  } catch {
    return undefined;
  }
};

export function createForegroundGuard(): ForegroundGuard {
  /** 最後に見た前面のアプリ。件をまたいで持つ（人が判定を置いている間に替わるのを見るため）。 */
  let last: string | undefined;

  return {
    async check(session, stepText) {
      const now = await readForeground(session);
      const reason = foregroundChangeReason(stepText, last, now);
      // 初めて見たとき（と、前が読めていなかったとき）は覚えるだけ。**止めたときは替えない。**
      if (last === undefined) last = now;
      return reason;
    },

    async remember(session) {
      // 読めなかったら忘れる。**読めなかった前と、読めた今を見比べて「替わった」と言わない。**
      last = await readForeground(session);
    },
  };
}
