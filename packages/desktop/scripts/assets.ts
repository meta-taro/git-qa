/**
 * **参照されているのに存在しないアセットを見つける**（product-baseline §23）。
 *
 * > 参照だけ足してアップロードを忘れると、ビルドもテストも通ったまま、実行時にだけ壊れる。
 * > CI で「参照されているのに存在しないアセット」を検出する仕組みを入れる。
 *
 * git-qa には、その仕組みが無かった（2026-09-11 に洗って見つけた）。
 * `tauri.conf.json` は 3 つの `resources` を参照しているのに、**そのうち 2 つを建てる
 * script は失敗を飲み込む**（`|| echo`）。**建てられなくても `pnpm build` は通る。**
 *
 * 飲み込むこと自体は意図したもの（Swift や cargo が無い環境でも開発は進められる）。
 * **足りないのは「飲み込んだあと、誰も数えていない」ところ。**
 */

/** `tauri.conf.json` の、この検査が見る部分だけ。**全部を知らなくてよい。** */
export interface AssetConfig {
  readonly bundle?: {
    readonly resources?: unknown;
    readonly icon?: unknown;
  };
}

/** 文字列だけを拾う。**形がおかしいものを、当て推量で埋めない。** */
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];

/** 配布物が参照しているファイルを、宣言から集める。 */
export function declaredAssets(config: AssetConfig): string[] {
  return [...strings(config.bundle?.resources), ...strings(config.bundle?.icon)];
}

/** 無いものだけを返す。**あるかどうかの判断は呼び側**（検査では差し替える）。 */
export function missingAssets(
  declared: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  return declared.filter((path) => !exists(path));
}

/**
 * **OS ごとの宣言を重ねる**（2026-09-11）。
 *
 * `git-qa-ocr`（Vision）・`git-qa-input`（CoreGraphics）・`git-qa-record`
 * （ScreenCaptureKit）は **macOS 専用**で、Windows では建てられない。
 * ところが `tauri.conf.json` は 3 つとも**無条件で参照していた。**
 *
 * このまま Windows 版を建てると、**建つ前に `pnpm check:assets` が落ちる。**
 * Windows で動かすのはウェブ検証と Android 検証で、**そもそもこの 3 つは要らない。**
 *
 * Tauri も `tauri.<OS>.conf.json` を同じように重ねる。**配列は置き換わる**ので、
 * ここでも置き換える（足し合わせると、要らないものを消せなくなる）。
 */
export function mergeAssetConfig(
  base: AssetConfig,
  forPlatform: AssetConfig | undefined,
): AssetConfig {
  if (forPlatform?.bundle === undefined) return base;

  return {
    bundle: {
      ...base.bundle,
      // **書かれていない方は消さない。**`resources` だけ書いた設定で、アイコンを失わない。
      ...(forPlatform.bundle.resources === undefined
        ? {}
        : { resources: forPlatform.bundle.resources }),
      ...(forPlatform.bundle.icon === undefined ? {} : { icon: forPlatform.bundle.icon }),
    },
  };
}
