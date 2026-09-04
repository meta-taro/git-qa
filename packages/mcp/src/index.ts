export { createDeviceTools } from './tools.js';
export type { DeviceTools, DeviceToolsOptions, Point, Screenshot } from './tools.js';
export {
  captureArgs,
  createWindowCapture,
  parseAllowed,
  parseWindowId,
  screenCaptureAllowedScript,
  windowIdScript,
} from './screen.js';
export type { CaptureMode, Screenshot as WindowScreenshot } from './screen.js';
