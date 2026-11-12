import type { MessageKey } from '../i18n/messages.js';

import { findTarget, isField, pressableOf, visibleIn, whyRefused } from './find.js';
import type { IsVisible } from './find.js';
import { CURSOR_IDLE_MS, HIGHLIGHT_MS, MOVE_MS, bubblePlacement, showMs } from './placement.js';
import type { AgentCommand } from './types.js';

/**
 * エージェントの専用カーソル（C120）。
 *
 * 人が開いている git-qa の画面の中で、エージェントが「いまどこを指しているか・何を押したか」を見せる。
 * **人のマウスとキーボードは使わない。**人は自分のマウスで同じ画面を同時に触っていてよい。
 *
 * 見た目は tadori と同じ：紫の矢印＋名前の札、押すと輪、指した所に枠、黄色の吹き出し。
 * **判定のキーは押さない。ハンドルの欄には打たない**（`whyRefused`）。
 */

export interface AgentCursorOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly t: (key: MessageKey, params?: Record<string, string>) => string;
  /** 見えているかの判定。試験では組み版が無いので差し替える。 */
  readonly isVisible?: IsVisible;
  /** 動きが終わるのを待つ。試験では待たない。 */
  readonly wait?: (ms: number) => Promise<void>;
}

export interface AgentCursor {
  /** 指示を 1 つ実行する。見つからなければ、そのことを画面に出す（黙って失敗しない）。 */
  run(command: AgentCommand): Promise<void>;
}

const AFTER_HOVER_MS = 1500;

export function createAgentCursor(options: AgentCursorOptions): AgentCursor {
  const { doc, win, t } = options;
  const isVisible = options.isVisible ?? visibleIn(win);
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((done) => win.setTimeout(done, ms)));

  let cursor: HTMLDivElement | undefined;
  let frame: HTMLDivElement | undefined;
  let bubble: HTMLDivElement | undefined;
  let hideTimer: number | undefined;
  let idleTimer: number | undefined;
  let hovering = false;

  const setTag = (text: string): void => {
    const tag = cursor?.querySelector('.agent-cursor-tag');
    if (tag) tag.textContent = text;
  };

  const hideNow = (): void => {
    win.clearTimeout(hideTimer);
    hovering = false;
    if (frame) frame.hidden = true;
    if (bubble) bubble.hidden = true;
  };

  const hideLater = (ms = HIGHLIGHT_MS): void => {
    win.clearTimeout(hideTimer);
    win.clearTimeout(idleTimer);
    hideTimer = win.setTimeout(() => {
      if (!hovering) hideNow();
    }, ms);
    idleTimer = win.setTimeout(
      () => {
        if (!cursor || hovering) return;
        cursor.hidden = true;
        setTag(t('agent.tag'));
      },
      Math.max(CURSOR_IDLE_MS, ms + 1000),
    );
  };

  /** カーソル・枠・吹き出し（はじめて使うときに作る）。 */
  const ensure = (): { cursor: HTMLDivElement; frame: HTMLDivElement; bubble: HTMLDivElement } => {
    if (cursor && frame && bubble) return { cursor, frame, bubble };

    cursor = doc.createElement('div');
    cursor.className = 'agent-cursor';
    cursor.hidden = true;
    cursor.setAttribute('aria-hidden', 'true');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 2l15 9.5-6.6 1.4L16 20.5l-3 1.3-3.5-7.6L4 18z');
    svg.append(path);
    const tag = doc.createElement('span');
    tag.className = 'agent-cursor-tag';
    tag.textContent = t('agent.tag');
    cursor.append(svg, tag);
    doc.body.append(cursor);

    frame = doc.createElement('div');
    frame.className = 'agent-frame';
    frame.hidden = true;
    doc.body.append(frame);

    bubble = doc.createElement('div');
    bubble.className = 'agent-bubble';
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    const text = doc.createElement('span');
    text.className = 'agent-bubble-text';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'agent-bubble-close';
    close.setAttribute('aria-label', t('agent.close'));
    close.title = t('agent.close');
    close.textContent = '×';
    bubble.append(text, close);
    // 押すと消える。**マウスを乗せている間は消さない**（読み終わるまで待つ）。
    bubble.addEventListener('click', hideNow);
    bubble.addEventListener('mouseenter', () => {
      hovering = true;
      win.clearTimeout(hideTimer);
    });
    bubble.addEventListener('mouseleave', () => {
      hovering = false;
      hideLater(AFTER_HOVER_MS);
    });
    doc.body.append(bubble);

    return { cursor, frame, bubble };
  };

  const showBubble = (
    el: HTMLDivElement,
    rect: DOMRect,
    anchor: { x: number; y: number },
    message: string,
  ): void => {
    const text = el.querySelector('.agent-bubble-text');
    if (text) text.textContent = message;
    el.hidden = message === '';
    if (message === '') return;
    // 大きさを測ってから置く（折り返したあとの高さで、上下に入るかを決める）。
    el.style.left = '0px';
    el.style.top = '0px';
    const size = el.getBoundingClientRect();
    const place = bubblePlacement(
      rect,
      anchor,
      { width: size.width, height: size.height },
      { width: win.innerWidth, height: win.innerHeight },
    );
    el.dataset['side'] = place.side;
    el.style.left = `${String(Math.round(place.left))}px`;
    el.style.top = `${String(Math.round(place.top))}px`;
    el.style.setProperty('--tail', `${String(Math.round(place.tail))}px`);
  };

  const moveTo = async (el: HTMLElement, message: string): Promise<void> => {
    const parts = ensure();
    // 見えていないものは画面の中ほどへ寄せる。見えていれば動かさない。
    const before = el.getBoundingClientRect();
    const inView = before.top >= 0 && before.bottom <= win.innerHeight;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: inView ? 'nearest' : 'center', inline: 'nearest' });
    }
    const rect = el.getBoundingClientRect();
    const anchor = {
      x: Math.round(rect.left + Math.min(rect.width / 2, 40)),
      y: Math.round(rect.top + rect.height / 2),
    };
    parts.cursor.hidden = false;
    parts.cursor.style.transform = `translate(${String(anchor.x)}px, ${String(anchor.y)}px)`;
    parts.frame.hidden = false;
    parts.frame.style.left = `${String(rect.left - 4)}px`;
    parts.frame.style.top = `${String(rect.top - 4)}px`;
    parts.frame.style.width = `${String(rect.width + 8)}px`;
    parts.frame.style.height = `${String(rect.height + 8)}px`;
    showBubble(parts.bubble, rect, anchor, message);
    await wait(MOVE_MS);
  };

  const say = (message: string, seconds?: number): void => {
    const parts = ensure();
    parts.cursor.hidden = false;
    setTag(message);
    hideLater(showMs(message, seconds));
  };

  const ripple = (): void => {
    const parts = ensure();
    parts.cursor.classList.remove('click');
    void parts.cursor.offsetWidth;
    parts.cursor.classList.add('click');
  };

  const run = async (command: AgentCommand): Promise<void> => {
    if (command.action === 'say') {
      say(command.message, command.seconds);
      return;
    }
    if (command.action === 'go') {
      // `#` の後ろは id。git-qa の画面に id は少ない（topbar・app）。無ければ見つからないと言う。
      const el = doc.getElementById(command.hash.slice(1));
      if (el === null) {
        say(t('agent.notFound', { target: command.hash }));
        return;
      }
      await moveTo(el, command.message ?? '');
      hideLater(showMs(command.message ?? '', command.seconds));
      return;
    }

    const found = findTarget(doc, command.target, isVisible);
    if (found === undefined) {
      say(t('agent.notFound', { target: command.target }));
      return;
    }
    // **文字を指して「押した」ことにしない。**札の文字なら、その札のボタンへ寄せる。押せる物が無ければ言う。
    const el = command.action === 'click' ? (pressableOf(found) ?? found) : found;
    if (command.action === 'click' && pressableOf(found) === undefined) {
      await moveTo(found, t('agent.notPressable', { target: command.target }));
      hideLater(showMs(t('agent.notPressable', { target: command.target })));
      return;
    }
    if (command.action === 'type' && !isField(found)) {
      await moveTo(found, t('agent.notField', { target: command.target }));
      hideLater(showMs(t('agent.notField', { target: command.target })));
      return;
    }
    const refused = whyRefused(el, command.action);
    if (refused !== undefined) {
      // **指して見せるが、押さない・打たない。**理由は吹き出しで人にも見せる。
      await moveTo(el, t(refused === 'verdict' ? 'agent.refused.verdict' : 'agent.refused.handle'));
      hideLater(showMs(t('agent.refused.verdict')));
      return;
    }

    await moveTo(el, command.message ?? '');
    if (command.action === 'click') {
      ripple();
      // ページの中で押す（人のマウスは動かさない）。mousedown も送り、人の操作と同じに動くようにする。
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.click();
    }
    if (command.action === 'type' && isField(el)) {
      el.focus();
      el.value = command.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    hideLater(showMs(command.message ?? '', command.seconds));
  };

  return { run };
}
