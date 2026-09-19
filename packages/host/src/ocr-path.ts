import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 絵から文字を読む道具（段 2・C55）を探す。
 *
 * **Electron を相手にすると、これが無いと何も読めない**（2026-09-07 実測）。
 * 段 1（AX）は `group` しか返さないので、**「あると良い」ではなく「無いと動かない」。**
 * だから環境変数を知らない人でも見つかる形にする。
 */
export function ocrCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-ocr');
  // 手元で動かしたとき。`packages/host/src` から数えて、建てた先を見に行く。
  const inRepo = resolve(fromDir, '..', '..', 'desktop', 'src-tauri', 'resources', 'git-qa-ocr');
  return [...new Set([beside, inRepo])];
}

/** 実際にあるものを 1 つ返す。**無ければ undefined**（段 1 だけで動く）。 */
export async function findOcr(
  fromDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string | undefined> {
  const fromEnv = process.env['GIT_QA_OCR'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of ocrCandidates(fromDir)) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**無いこと自体は普通**（同梱前・建てる前）。
    }
  }
  return undefined;
}

/**
 * 画面を触る道具（`git-qa-input`）を探す。
 *
 * **無くても動く**が、そのときは押すたびに相手が前面へ出る（C57 追記）。
 * `git-qa-ocr` と同じで、**環境変数を知らない人でも見つかる形**にしておく。
 */
export function inputCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-input');
  // 手元で建てたとき。cargo は crate の下の `target/release` へ置く。
  const inRepo = resolve(
    fromDir,
    '..',
    '..',
    'adapter-desktop',
    'tools',
    'input',
    'target',
    'release',
    'git-qa-input',
  );
  return [...new Set([beside, inRepo])];
}

/** 実際にあるものを 1 つ返す。**無ければ undefined**（前面へ出す道へ落ちる）。 */
export async function findInput(
  fromDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string | undefined> {
  const fromEnv = process.env['GIT_QA_INPUT'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of inputCandidates(fromDir)) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**無いこと自体は普通**（建てる前）。
    }
  }
  return undefined;
}

/**
 * 窓を録る道具（`git-qa-record`）を探す。
 *
 * **録るのは相手のアプリではなく、git-qa の窓**（2026-09-11・人の判断）。
 * そこには**人が見たものが全部入っている** —— ライブ映像、いまどのケースを
 * 判定していたか、AI が何と言ったか、矢印がどこを指していたか。
 *
 * **無くても動く**（録画が `unsupported` になるだけ）。
 * ScreenCaptureKit を使う **macOS 専用**で、Windows では建てられない。
 */
export function recordCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-record');
  const inRepo = resolve(fromDir, '..', '..', 'desktop', 'src-tauri', 'resources', 'git-qa-record');
  return [...new Set([beside, inRepo])];
}

/** 実際にあるものを 1 つ返す。**無ければ undefined**（録画は `unsupported`）。 */
export async function findRecord(
  fromDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string | undefined> {
  const fromEnv = process.env['GIT_QA_RECORD'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of recordCandidates(fromDir)) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**無いこと自体は普通**（建てる前・macOS 以外）。
    }
  }
  return undefined;
}

/**
 * Windows で窓を見る道具（`git-qa-win.exe`）を探す（2026-09-12）。
 *
 * macOS 側の 3 本（OCR / 触る / 録る）に当たるものが、Windows ではこれ 1 本。
 * **無ければデスクトップ検証が丸ごとできない** —— `git-qa-ocr` のような
 * 「あると良い」ではなく「**無いと何もできない**」。
 */
export function winToolCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-win.exe');
  const inRepo = resolve(
    fromDir,
    '..',
    '..',
    'adapter-desktop',
    'tools',
    'win',
    'target',
    'release',
    'git-qa-win.exe',
  );
  return [...new Set([beside, inRepo])];
}

/** 実際にあるものを 1 つ返す。**無ければ undefined**（デスクトップ検証ができない）。 */
export async function findWinTool(
  fromDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string | undefined> {
  const fromEnv = process.env['GIT_QA_WIN'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of winToolCandidates(fromDir)) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**macOS では無いのが普通。**
    }
  }
  return undefined;
}

/**
 * **iPhone / iPad を映す道具**（`git-qa-ios`・2026-09-19）。
 *
 * **無ければ、その相手は見られない**（`git-qa-ocr` と違い、代わりの道が無い）。
 * macOS 専用（AVFoundation で USB の端末を撮る）。
 */
export function iosCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-ios');
  const inRepo = resolve(fromDir, '..', '..', 'desktop', 'src-tauri', 'resources', 'git-qa-ios');
  return [...new Set([beside, inRepo])];
}

/** 実際にあるものを 1 つ返す。**無ければ undefined**（iOS は見られない）。 */
export async function findIos(
  fromDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string | undefined> {
  const fromEnv = process.env['GIT_QA_IOS'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of iosCandidates(fromDir)) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**無いこと自体は普通**（macOS 以外・建てる前）。
    }
  }
  return undefined;
}
