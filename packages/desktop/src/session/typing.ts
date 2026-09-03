import { MAIN_COLUMN_ID } from '../columns.js';
import { t } from '../i18n/current.js';

/**
 * 端末へ文字を送る欄。
 *
 * **端末の `input text` は IME を通らない。**日本語は送れないので、
 * 黙って化けた文字を送らず、送れないと言う（AI 側と同じ制限・C34）。
 */

export interface TextSenderOptions {
  readonly onSend: (text: string) => void;
  readonly onError: (message: string) => void;
}

const ASCII_ONLY = /^[\x20-\x7e]+$/;

export function installTextSender(root: HTMLElement, options: TextSenderOptions): void {
  const doc = root.ownerDocument;
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) {
    throw new Error(`ライブビューのカラム（${MAIN_COLUMN_ID}）が画面に無い`);
  }
  column.querySelector('.typing')?.remove();

  const bar = doc.createElement('div');
  bar.className = 'typing';

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'typing-input';
  input.placeholder = t('typing.placeholder');

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typing-send';
  button.textContent = t('typing.send');

  const submit = (): void => {
    const text = input.value;
    if (text === '') return;
    if (!ASCII_ONLY.test(text)) {
      // **打ち直せるように、欄は空にしない。**
      options.onError(t('typing.notAscii'));
      return;
    }
    options.onSend(text);
    // 同じ文字を二度送らない。
    input.value = '';
  };

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  bar.append(input, button);
  column.append(bar);
}
