import { readFileSync } from 'node:fs';

// ajv は CJS で配られている。既定書き出しは Node からだと名前空間として見えるので、
// 名前付きで取り出す（`new Ajv2020()` が構築できる形になる）。
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import formatsPlugin from 'ajv-formats';

/**
 * `run.json` の形の正本は JSON Schema ファイルの側。
 * TypeScript の型はその写しであって、検証はこちらで行う。
 */
export const RUN_SCHEMA: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../schema/run.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // `if`/`then` の中で条件付きの必須を書くと、その枝には properties が無いので
  // strictRequired に引っかかる。列そのものは親（case / caseRecording）で
  // additionalProperties: false 付きで定義してあるため、綴り違いはそちらで落ちる。
  strictRequired: false,
});
formatsPlugin.default(ajv);

const validator: ValidateFunction = ajv.compile(RUN_SCHEMA);

export interface ValidationResult {
  valid: boolean;
  /** 人が読んで直せる形にした違反。空なら valid。 */
  errors: string[];
}

/** `run.json` として読める形かを検証する。落ちた場所を必ず添える。 */
export function validateRun(value: unknown): ValidationResult {
  const valid = validator(value);
  if (valid) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: (validator.errors ?? []).map(formatError) };
}

function formatError(error: ErrorObject): string {
  const where = error.instancePath === '' ? '/' : error.instancePath;
  // どのキーが問題かは params にしか出ないことがある（余計なキー・足りないキー）。
  const detail = Object.values(error.params)
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  return [where, error.message ?? '', detail].filter((s) => s !== '').join(' ');
}
