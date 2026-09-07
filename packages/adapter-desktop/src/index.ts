export {
  anyWindowScript,
  captureArgs,
  missingWindowMessage,
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
export { clickScript } from './click.js';
export { explainToolFailure } from './permission.js';
