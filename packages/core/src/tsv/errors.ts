/**
 * TSV の読み取りに失敗したときのエラー。
 *
 * 物理行番号を必ず添える。検証シートは人が md-business のグリッドで開いて直すものなので、
 * 「何行目か」が無いと直せない。
 */
export class TsvParseError extends Error {
  override readonly name = 'TsvParseError';

  /** 1 始まりの物理行番号。行に紐づかないエラーでは undefined */
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${line} 行目: ${message}`);
    this.line = line;
  }
}
