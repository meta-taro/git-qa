import runSchema from '../../schema/run.schema.json' with { type: 'json' };

/**
 * 置いた人のハンドル。
 *
 * **規則は証跡の schema が正本**（C18）なので、ここでは書き写さず、そこから読む。
 * 二重に書くと、片方だけ直したときに**入口は通るのに保存で落ちる**という形で壊れる。
 *
 * 入口で弾かないと、5 件置き終わったあとの保存で落ちる。実際にそれが起き、
 * **人が実機で置いた 5 件が 2 回とも消えた**（2026-09-04）。
 */
const pattern = (runSchema as { $defs: { handle: { pattern: string } } }).$defs.handle.pattern;

/** ハンドルの規則。画面に出して人へ見せるためにも使う。 */
export const HANDLE_RULE = new RegExp(pattern);

export function isValidHandle(handle: string): boolean {
  return HANDLE_RULE.test(handle);
}
