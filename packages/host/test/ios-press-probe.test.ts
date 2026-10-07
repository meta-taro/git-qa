import { describe, expect, it } from 'vitest';

import { iosPressProbe } from '../src/doctor-probes.js';

/**
 * **iPhone / iPad を押す口が生きているか**を、doctor が言う（C99）。
 * 口（WebDriverAgent）を起こすのは人の作業。**渡されていない・届かない・生きている**を分けて言う。
 */
const reply = (body: unknown) => () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('iosPressProbe', () => {
  it('口が渡されていなければ、渡し方の案内を出す（欠けている扱いにはしない）', async () => {
    const said = await iosPressProbe(undefined, reply({}));

    expect(said.state).toBe('skip');
    expect(said.detail).toContain('GIT_QA_IOS_WDA');
    expect(said.detail).toContain('docs/ios-press.md');
  });

  it('生きていれば、WebDriverAgent の版と端末の iOS を出す', async () => {
    const said = await iosPressProbe(
      'http://127.0.0.1:8100',
      reply({ value: { ready: true, build: { version: '16.14.0' }, os: { version: '17.5.1' } } }),
    );

    expect(said.state).toBe('ok');
    expect(said.detail).toContain('WebDriverAgent 16.14.0');
    expect(said.detail).toContain('iOS 17.5.1');
  });

  it('届かなければ、何を見ればよいかを言う', async () => {
    const said = await iosPressProbe('http://127.0.0.1:8100', () =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );

    expect(said.state).toBe('missing');
    expect(said.detail).toContain('ECONNREFUSED');
    expect(said.detail).toContain('起きているか');
  });
});
