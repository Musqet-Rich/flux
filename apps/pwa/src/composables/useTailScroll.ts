import type { Ref } from 'vue';
import { nextTick, ref } from 'vue';

// Keeps a timeline pinned to its end only while the operator is already there. Events land
// several times a second while an agent works, so unconditionally scrolling on each one makes
// reading anything earlier impossible. "At the tail" is measured, not assumed: within
// `threshold` px of the bottom on the last `scroll` event, re-measured after each jump. New
// content while scrolled up is counted for the "new activity" pill instead of moving the view.

const threshold = 32;

export interface TailScroll {
  scroller: Ref<HTMLElement | null>;
  atTail: Ref<boolean>;
  behind: Ref<boolean>;
  unread: Ref<number>;
  measure: () => void;
  follow: (added: number) => Promise<void>;
  jump: () => Promise<void>;
  reset: () => void;
}

const nearBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;

export const useTailScroll = (): TailScroll => {
  const scroller = ref<HTMLElement | null>(null);
  const atTail = ref(true);
  const behind = ref(false);
  const unread = ref(0);

  const measure = (): void => {
    const el = scroller.value;
    if (el === null) return;
    atTail.value = nearBottom(el);
    if (atTail.value) {
      behind.value = false;
      unread.value = 0;
    }
  };

  const jump = async (): Promise<void> => {
    await nextTick();
    const el = scroller.value;
    if (el !== null) el.scrollTop = el.scrollHeight;
    atTail.value = true;
    behind.value = false;
    unread.value = 0;
  };

  const follow = async (added: number): Promise<void> => {
    if (atTail.value) {
      await jump();
      return;
    }
    behind.value = true;
    unread.value += added;
  };

  const reset = (): void => {
    atTail.value = true;
    behind.value = false;
    unread.value = 0;
  };

  return { scroller, atTail, behind, unread, measure, follow, jump, reset };
};
