/**
 * **エージェントが操作できる相手を選ぶ**（人の指示・2026-09-17）。
 *
 * > 全自動でテスト動画をとる場合、エージェントの操作は必須となります。
 *
 * MCP の道具（`tools.ts`）は**アダプタ非依存**で、**相手を選ぶ配線だけが Android 固定**だった。
 * README の表は 3 つとも触れるように読めていた（外部レビュー meta-taro/git-qa#23）。
 *
 * **当て推量で相手を決めない。**行き先が無いまま繋ぐと、別の場所を触る（C40）。
 */

export type McpTarget =
  | { readonly kind: 'android'; readonly serial?: string }
  | { readonly kind: 'web'; readonly url: string; readonly attachTo?: string }
  | { readonly kind: 'desktop'; readonly app: string }
  /**
   * iPhone / iPad（2026-09-19・C75）。
   *
   * **押す口は無い。**AI にできるのは**見る・読む**だけ。
   * それでも受け取る口が無いと、**AI は画面を 1 文字も読めない。**
   */
  | { readonly kind: 'ios'; readonly device?: string };

const said = (env: NodeJS.ProcessEnv, key: string): string | undefined => {
  const value = env[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

export function mcpTargetFrom(env: NodeJS.ProcessEnv): McpTarget {
  const kind = said(env, 'GIT_QA_MCP_TARGET') ?? 'android';

  if (kind === 'android') {
    const serial = said(env, 'GIT_QA_ANDROID_SERIAL');
    return serial === undefined ? { kind: 'android' } : { kind: 'android', serial };
  }

  if (kind === 'web') {
    const url = said(env, 'GIT_QA_MCP_URL');
    // **行き先が無いまま繋がない。**当て推量で別の場所を見に行かせない（C40）。
    if (url === undefined) {
      throw new Error('ウェブを触るには GIT_QA_MCP_URL に最初に開く場所を渡す');
    }
    const attachTo = said(env, 'GIT_QA_CDP');
    return attachTo === undefined ? { kind: 'web', url } : { kind: 'web', url, attachTo };
  }

  if (kind === 'desktop') {
    const app = said(env, 'GIT_QA_MCP_APP');
    if (app === undefined) {
      throw new Error('デスクトップアプリを触るには GIT_QA_MCP_APP にアプリ名（窓の持ち主）を渡す');
    }
    return { kind: 'desktop', app };
  }

  if (kind === 'ios') {
    // **端末を指さなくてよい。**繋がっている 1 台目を使う（挿し替えは人がする）。
    const device = said(env, 'GIT_QA_MCP_IOS_DEVICE');
    return device === undefined ? { kind: 'ios' } : { kind: 'ios', device };
  }

  // **知らない相手は受け取らない。**当てにいくと、別のものを触る。
  throw new Error(`知らない相手: ${kind}（android / web / ios / desktop のどれか）`);
}

/** **いま何を触っているかを、AI へ最初に言う。**取り違えたまま操作させない。 */
export function targetHint(target: McpTarget): string {
  if (target.kind === 'web') {
    const where = target.attachTo === undefined ? '' : '（既に起きているブラウザに繋いだ）';
    return `いま触っているのはウェブページ: ${target.url}${where}`;
  }
  if (target.kind === 'desktop') return `いま触っているのはデスクトップアプリ: ${target.app}`;
  if (target.kind === 'ios') {
    // **押せないことを最初に言う。**操作できるつもりで回させない。
    return (
      'いま見ているのは iPhone / iPad（USB で映している）。' +
      '**押す口はありません** —— 見る・読むだけできます。操作は人に頼んでください'
    );
  }
  return 'いま触っているのは Android 端末';
}
