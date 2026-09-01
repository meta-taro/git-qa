/**
 * 外のコマンド（adb / scrcpy）を呼ぶ口。
 *
 * **ここを差し替えられる形にしておくのが目的**（product-baseline §9）。
 * 実機や adb が無い環境でもアダプタの中身を検査できるようにするため、
 * 本物の起動はこのポートの向こう側だけに置く。
 */

export interface CommandResult {
  readonly code: number;
  /** バイト列で返す。screencap の PNG は文字列にすると壊れる。 */
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** 起動しっぱなしにするもの（scrcpy のライブビュー・録画）。 */
export interface RunningProcess {
  readonly isRunning: boolean;
  stop(): Promise<void>;
}

export interface CommandRunner {
  /** 終わるまで待つ。 */
  run(command: string, args: readonly string[]): Promise<CommandResult>;
  /** 起動して即座に返す。止めるのは呼んだ側。 */
  start(command: string, args: readonly string[]): RunningProcess;
}
