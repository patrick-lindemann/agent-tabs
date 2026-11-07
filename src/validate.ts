import type { WebviewMessage } from './types';

const MAX_TEXT = 1_000_000;
const MAX_ID = 256;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isString = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === 'string' && value.length <= max;
const isId = (value: unknown): value is string => isString(value, MAX_ID) && value.length > 0;
const isDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000;
const isLineNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000;

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'ready':
      return (
        (value.cols === undefined || isDimension(value.cols)) &&
        (value.rows === undefined || isDimension(value.rows))
      );
    case 'input':
      return isId(value.id) && isString(value.data);
    case 'resize':
      return isId(value.id) && isDimension(value.cols) && isDimension(value.rows);
    case 'closeTab':
    case 'switchTab':
      return isId(value.id);
    case 'openFile':
      return (
        isId(value.id) &&
        isString(value.path, 32_000) &&
        (value.line === undefined || isLineNumber(value.line)) &&
        (value.column === undefined || isLineNumber(value.column))
      );
    case 'focus':
      return typeof value.focused === 'boolean';
    case 'newTab':
    case 'newTabWithProfile':
    case 'newTabWithCommand':
      return Object.keys(value).length === 1;
    default:
      return false;
  }
}
