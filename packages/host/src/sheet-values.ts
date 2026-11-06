import type { ValueSource } from '@git-qa/core';

/**
 * **シートに書けない値を、git-qa を起こした環境から取る**（C113・§14・2026-11-06）。
 *
 * ライセンスキーやパスワードは検証シートに書けない（commit されるため）。それだと、
 * その欄を打つ行は自動では流せず、**秘密を扱う画面がすべて人の手に残る**（iPhone の席で 16 行中 8 行）。
 * 手順には `$LICENSE_KEY` と書き、値は環境変数 `LICENSE_KEY` から取る。
 *
 * **値はここを通るだけ。**ログ・証跡・画面には出さない（足跡には `$LICENSE_KEY` のまま残る）。
 * 空の環境変数は「無い」と同じ（空を打っても確かめたことにならない）。
 */
export function valuesFromEnv(env: Readonly<Record<string, string | undefined>>): ValueSource {
  return (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
}
