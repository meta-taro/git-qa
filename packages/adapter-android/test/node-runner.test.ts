import { describe, expect, it } from 'vitest';

import { createNodeCommandRunner } from '../src/index.js';

/**
 * **本物のプロセスを起動する側の検査。**
 *
 * ここは「差し替えられる形にした」の向こう側で、端末が無いと 1 行も通っていなかった。
 * 子プロセスには **node 自身**を使う。`sh` や `echo` に頼ると Windows で走らない
 * （この製品の本命は Windows）。
 */

const node = process.execPath;
const runner = createNodeCommandRunner();
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('run', () => {
  it('標準出力をバイト列で返す', async () => {
    const result = await runner.run(node, ['-e', 'process.stdout.write("こんにちは")']);
    expect(result.code).toBe(0);
    expect(text(result.stdout)).toBe('こんにちは');
  });

  it('バイナリを壊さない', async () => {
    // screencap の PNG がここを通る。文字列にすると壊れる。
    const result = await runner.run(node, [
      '-e',
      'process.stdout.write(Buffer.from([0x89,0x50,0x4e,0x47,0x00,0xff]))',
    ]);
    expect([...result.stdout]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  });

  it('分割して届いても繋ぎ直す', async () => {
    const result = await runner.run(node, [
      '-e',
      'process.stdout.write("あ");setTimeout(()=>process.stdout.write("い"),30)',
    ]);
    expect(text(result.stdout)).toBe('あい');
  });

  it('標準エラーを分けて返す', async () => {
    const result = await runner.run(node, ['-e', 'process.stderr.write("だめ")']);
    expect(result.stderr).toBe('だめ');
    expect(text(result.stdout)).toBe('');
  });

  it('失敗した終了コードを、投げずに返す', async () => {
    // adb は「端末が無い」を終了コードで返す。投げると理由を添えられない。
    const result = await runner.run(node, ['-e', 'process.exit(3)']);
    expect(result.code).toBe(3);
  });

  it('コマンドが無いときは、握り潰さずに投げる', async () => {
    await expect(runner.run('git-qa-存在しないコマンド', [])).rejects.toThrow();
  });
});

describe('start', () => {
  it('起動したら動いていると分かり、止めたら止まる', async () => {
    const p = runner.start(node, ['-e', 'setInterval(()=>{},1000)']);
    expect(p.isRunning).toBe(true);

    await p.stop();
    expect(p.isRunning).toBe(false);
  });

  it('自分で終わったプロセスを止めても、待ち続けない', async () => {
    // 止め忘れを防ぐために毎回 stop を呼ぶ。既に終わっていても返ること。
    const p = runner.start(node, ['-e', '']);
    await new Promise((r) => setTimeout(r, 200));

    await p.stop();
    expect(p.isRunning).toBe(false);
  });

  it('二重に止めても落ちない', async () => {
    const p = runner.start(node, ['-e', 'setInterval(()=>{},1000)']);
    await p.stop();
    await p.stop();
    expect(p.isRunning).toBe(false);
  });
});

describe('stream', () => {
  it('届いた順に流し、プロセスが終わると尽きる', async () => {
    const p = runner.stream(node, [
      '-e',
      'process.stdout.write("あ");setTimeout(()=>{process.stdout.write("い");process.exit(0)},30)',
    ]);

    const got: string[] = [];
    for await (const chunk of p.chunks) got.push(text(chunk));

    expect(got.join('')).toBe('あい');
    expect(p.isRunning).toBe(false);
  });

  it('読み手が遅れても取りこぼさない', async () => {
    // 受け手が読むより速く届く。捨てると映像に穴が空く。
    const p = runner.stream(node, [
      '-e',
      'for(let i=0;i<50;i++)process.stdout.write(String(i)+",");process.exit(0)',
    ]);
    await new Promise((r) => setTimeout(r, 100));

    let all = '';
    for await (const chunk of p.chunks) all += text(chunk);

    expect(all.split(',').filter((x) => x !== '')).toHaveLength(50);
  });

  it('止めると、流し終わっていなくても止まる', async () => {
    const p = runner.stream(node, ['-e', 'setInterval(()=>process.stdout.write("x"),10)']);
    await new Promise((r) => setTimeout(r, 50));

    await p.stop();
    expect(p.isRunning).toBe(false);
  });

  it('自分で終わったプロセスを止めても、待ち続けない', async () => {
    const p = runner.stream(node, ['-e', 'process.exit(0)']);
    await new Promise((r) => setTimeout(r, 200));

    await p.stop();
    expect(p.isRunning).toBe(false);
  });

  it('起動できないコマンドでも、読み手を永遠に待たせない', async () => {
    // 待たせると「映像が来ない」まま固まる。尽きて終わること。
    const p = runner.stream('git-qa-存在しないコマンド', []);
    const got: Uint8Array[] = [];
    for await (const chunk of p.chunks) got.push(chunk);

    expect(got).toHaveLength(0);
    expect(p.isRunning).toBe(false);
  });
});
