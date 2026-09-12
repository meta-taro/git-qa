export {
  anyWindowScript,
  captureArgs,
  missingWindowMessage,
  notFrontmost,
  parseWindow,
  windowScript,
} from './window.js';
export type { WindowRef } from './window.js';
export { axScript, findInElements, manualAccessibilityScript, parseElements } from './ax.js';
export type { AxElement } from './ax.js';
export { findInOcr, parseOcr } from './ocr.js';
export type { OcrLine } from './ocr.js';
export { createDesktopAdapter, screenTextOf } from './adapter.js';
export type { DesktopAdapterOptions } from './adapter.js';
export { readDesktopScreenText } from './screen-text.js';
export { clickScript, dragScript, NOT_FRONT_MARK, scrollScript } from './click.js';
export { explainToolFailure } from './permission.js';
export { exePathArgs, fingerprintOf, parseExePath } from './fingerprint.js';
export { createWindowsDesktopAdapter } from './win/adapter.js';
export type { WindowsDesktopAdapterOptions } from './win/adapter.js';
export { parseWinWindows, winArgs } from './win/tool.js';
export type { WinWindow } from './win/tool.js';
export { whyNoDesktop } from './win/pick.js';
