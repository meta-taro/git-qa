import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Target, TargetAdapter, TargetSession } from '@git-qa/core';
import { AdapterError } from '@git-qa/core';

import { pidAlive } from './screens.js';

/**
 * **同じ機械の別の席が同じ端末を掴んでいれば、名乗りで先に断る**（C121 の 3 つ目）。
 *
 * 実機（iPhone / Android）は 1 台を複数の席で使うことがある。前面の見張り（`foreground-guard.ts`）は
 * 触ってから「替わった」に気づく守りで、こちらは**触る前に、同じ機械の中で分かる分だけ**断る。
 * 別の機械から掴んでいる分は見えないので、見張りが本線で、こちらは前置き。
 *
 * 置き場所と捨て方は画面の名乗り（`screens.ts`）と同じ：ホームの下・自分だけが読める・
 * 置いた席の pid が生きていなければ残骸として捨てる。
 */

export interface DeviceClaim {
  /** 端末の鍵（{@link deviceKey}）。 */
  readonly device: string;
  readonly pid: number;
  /** 掴んだ席の git-qa の名乗り（`v0.2.1` / `0.2.0-dev`）。 */
  readonly release: string;
  /** 何をしている席か（人に見せる 1 行。「検証の実行（シート名）」「MCP の席」）。 */
  readonly seat: string;
  readonly startedAt: string;
}

export function deviceClaimsDir(home: string = homedir()): string {
  return join(home, '.git-qa', 'devices');
}

/**
 * 端末の鍵。識別子（iPhone の UDID・Android の serial）を省いた席は「最初に見つかるもの」を使うので、
 * **同じ 1 つの鍵に寄せる** —— 1 台しか繋いでいない機械で、省いた席どうしがぶつかるのを見るため。
 */
export function deviceKey(kind: Target['kind'], id: string | undefined): string {
  return `${kind}:${id ?? '(default)'}`;
}

/** ファイル名に使えない字を潰す（鍵は `ios:0000…` の形で `:` を含む）。 */
const fileNameOf = (device: string): string => `${device.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;

const isClaim = (value: unknown): value is DeviceClaim =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as DeviceClaim).device === 'string' &&
  typeof (value as DeviceClaim).pid === 'number' &&
  typeof (value as DeviceClaim).release === 'string' &&
  typeof (value as DeviceClaim).seat === 'string' &&
  typeof (value as DeviceClaim).startedAt === 'string';

/** いま置かれている名乗りを読む。無い・読めない・死んでいるなら `undefined`（読めないものは捨てる）。 */
const readHolder = (path: string, isAlive: (pid: number) => boolean): DeviceClaim | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    // 壊れた名乗り。残しておくと、誰も掴んでいないのに永く断り続ける。
    forget(path);
    return undefined;
  }
  if (!isClaim(parsed) || !isAlive(parsed.pid)) {
    forget(path);
    return undefined;
  }
  return parsed;
};

const forget = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // 既に無い。外れていればよい。
  }
};

export type ClaimResult =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly holder: DeviceClaim };

/**
 * 端末を掴む。**生きている別の席が掴んでいれば断り、その名乗りを返す。**
 * 自分の pid の名乗りは掴み直せる（同じ席が二度目に繋ぐとき）。
 * 同期で書く（終わり際の合図の中からも外せるように、画面の名乗りと揃える）。
 */
export function claimDevice(
  claim: DeviceClaim,
  dir: string = deviceClaimsDir(),
  isAlive: (pid: number) => boolean = pidAlive,
): ClaimResult {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, fileNameOf(claim.device));
  const holder = readHolder(path, isAlive);
  if (holder !== undefined && holder.pid !== claim.pid) {
    return { ok: false, holder };
  }
  const body: DeviceClaim = {
    device: claim.device,
    pid: claim.pid,
    release: claim.release,
    seat: claim.seat,
    startedAt: claim.startedAt,
  };
  writeFileSync(path, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
  return {
    ok: true,
    release: () => {
      forget(path);
    },
  };
}

/** 人に見せる断りの文。**最後の行に、何をすればよいか。** */
export function heldByReason(holder: DeviceClaim): string {
  const since = holder.startedAt.replace('T', ' ').slice(0, 16);
  return (
    `いま、この機械の別の席（${holder.seat}・pid ${String(holder.pid)}・git-qa ${holder.release}・` +
    `${since} から）が、この端末（${holder.device}）を使っています。` +
    'その席が終わるのを待つか、その席を閉じてから、もう一度始める'
  );
}

export interface ClaimingAdapterOptions {
  /** 端末の鍵（{@link deviceKey}）。 */
  readonly device: string;
  /** 何をしている席か（人に見せる 1 行）。 */
  readonly seat: string;
  /** この席の git-qa の名乗り。 */
  readonly release: string;
  readonly dir?: string;
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => Date;
}

/**
 * アダプタを包み、**繋ぐ前に掴み、閉じるときに外す。**
 * 掴めなければ相手に触らずに `AdapterError` で断る（理由は {@link heldByReason}）。
 * 繋ぐのに失敗したら掴みも外す（掴んだまま居なくなると、生きている間ずっと断り続ける）。
 */
export function claimingAdapter(
  adapter: TargetAdapter,
  options: ClaimingAdapterOptions,
): TargetAdapter {
  const now = options.now ?? ((): Date => new Date());
  return {
    kind: adapter.kind,
    capabilities: adapter.capabilities,
    async connect(): Promise<TargetSession> {
      const claimed = claimDevice(
        {
          device: options.device,
          pid: process.pid,
          release: options.release,
          seat: options.seat,
          startedAt: now().toISOString(),
        },
        options.dir,
        options.isAlive,
      );
      if (!claimed.ok) {
        throw new AdapterError(adapter.kind, heldByReason(claimed.holder));
      }
      let session: TargetSession;
      try {
        session = await adapter.connect();
      } catch (error: unknown) {
        claimed.release();
        throw error;
      }
      return releasingSession(session, claimed.release);
    },
  };
}

/**
 * 閉じるときに名乗りを外すセッション。**中身の口はそのまま通す**（在る口だけ・無い口は生やさない）。
 * `isClosed` は読むたびに中身を見る（写し取ると、閉じたあとも「開いている」と言う）。
 */
const releasingSession = (session: TargetSession, release: () => void): TargetSession =>
  new Proxy(session, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          release();
          await target.close();
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
