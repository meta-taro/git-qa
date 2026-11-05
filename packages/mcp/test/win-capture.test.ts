import { describe, expect, it } from 'vitest';

import { createWinWindowCapture } from '../src/win-capture.js';

/**
 * **Windows でも、AI が自分の画面を見られる。**
 *
 * macOS の口（`osascript` / `screencapture`）しか無く、Windows では `app_screenshot` が
 * 何も撮れずに落ちていた（2026-11-05 の報告）。
 */

const WINDOWS = [
  '1001\t42\tC:\\Program Files\\git-qa\\git-qa.exe\tgit-qa\t0\t0\t1280\t800',
  '1002\t42\tC:\\Program Files\\git-qa\\git-qa.exe\t\t0\t0\t16\t16',
].join('\n');

function fake(stdoutOf: (args: readonly string[]) => string) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const capture = createWinWindowCapture({
    toolPath: 'C:\\tools\\git-qa-win.exe',
    run: (command, args) => {
      calls.push({ command, args });
      return Promise.resolve(stdoutOf(args));
    },
    readFile: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    tmpPath: () => 'C:\\tmp\\git-qa-window.png',
  });
  return { capture, calls };
}

describe('createWinWindowCapture', () => {
  it('窓を git-qa-win で探し、いちばん大きい窓を撮る（16x16 の道具窓は選ばない）', async () => {
    const { capture, calls } = fake((args) => (args[0] === 'windows' ? WINDOWS : ''));

    const shot = await capture('git-qa');

    expect(shot.mimeType).toBe('image/png');
    expect(Buffer.from(shot.base64, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(calls.map((c) => c.command)).toEqual([
      'C:\\tools\\git-qa-win.exe',
      'C:\\tools\\git-qa-win.exe',
    ]);
    expect(calls[1]?.args).toEqual(['shot', '1001', 'C:\\tmp\\git-qa-window.png']);
  });

  it('窓が無ければ、黙って空の絵を返さずに言う', async () => {
    const { capture } = fake(() => '');

    await expect(capture('git-qa')).rejects.toThrow('窓が見つからない: git-qa');
  });

  it('画面全体は撮れない、と言う（窓だけ）', async () => {
    const { capture, calls } = fake(() => WINDOWS);

    await expect(capture('git-qa', 'screen')).rejects.toThrow('画面全体は撮れない');
    expect(calls).toEqual([]);
  });
});
