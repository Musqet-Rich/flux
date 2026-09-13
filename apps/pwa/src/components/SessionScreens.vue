<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { useWide } from '../composables/useWide.ts';
import type { Route } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import { splitAt } from '../store/split-at.ts';
import PaneDivider from './PaneDivider.vue';
import SessionPanel from './SessionPanel.vue';
import SessionView from './SessionView.vue';

// The screens of one session, laid out by the width (ADR 0033). On a phone the route is the
// screen: the chat, or one of the panel's screens in its place. On a wide screen the chat stays
// on the left and a panel route opens the panel beside it in a pane, the chat route alone
// closing it; the route stays the one source of what is shown, so deep links, the toolbar's
// buttons, the browser's Back and the views' own Back all work unchanged. The chat is one
// element in one place whichever the width, so opening and closing the pane keep its scroll
// and its draft (a flip of the width itself while a panel route is up does remount it, since
// a phone has no chat on that route; the panel stays). The divider's place is the chat's share of the width, the device's own
// (split-at.ts), sized live while dragged and kept when let go.

type SessionRoute = Extract<Route, { session: string }>;

const props = defineProps<{ store: Store; route: SessionRoute }>();
const emit = defineEmits<{ go: [to: Route] }>();

const wide = useWide();
// A panel route: the pane on a wide screen, the whole screen on a phone. The template tests
// the name again where it renders the panel, since only that narrows the route's type for it.
const panelRoute = computed(() => props.route.name !== 'session');
const split = computed(() => wide.value && panelRoute.value);
const chatShown = computed(() => wide.value || !panelRoute.value);
const row = ref<HTMLElement | null>(null);
const pane = ref<HTMLElement | null>(null);
// The share while dragging; the store's once let go, and whatever the store loads.
const share = ref(props.store.state.splitAt);
watch(
  () => props.store.state.splitAt,
  (at) => {
    share.value = at;
  },
);
// The divider's width, `--divider` on the row, is the part of the row that is neither pane.
const dividerPx = 6;
// A share is a whole percent, clamped: what is kept is clean, not a pointer's or a float's drift.
const place = (at: number): number => splitAt.clamp(Math.round(at * 100) / 100);
const drag = (x: number): void => {
  const el = row.value;
  if (el === null) return;
  const { left, width } = el.getBoundingClientRect();
  const panes = width - dividerPx;
  if (panes > 0) share.value = place((x - left) / panes);
};
const step = (by: number): void => {
  share.value = place(share.value + by * splitAt.step);
};
const done = (): void => {
  void props.store.setSplitAt(share.value);
};

const go = (to: Route): void => {
  emit('go', to);
};
const openChanges = (): void => {
  go({ name: 'changes', session: props.route.session });
};
const openFiles = (): void => {
  go({ name: 'files', session: props.route.session, path: '' });
};
// Closing the pane takes its button with it; the focus goes to the message box, the reason
// the chat is there.
const close = async (): Promise<void> => {
  go({ name: 'session', session: props.route.session });
  await nextTick();
  row.value?.querySelector('textarea')?.focus();
};
</script>

<template>
  <div ref="row" class="row" :class="{ split }" :style="{ '--divider': `${dividerPx}px` }">
    <div v-if="chatShown" class="chat" :style="{ '--share': share }">
      <SessionView
        :store="store"
        :session="route.session"
        :pane="pane"
        @changes="openChanges"
        @files="openFiles"
        @closed="go({ name: 'sessions' })"
      />
    </div>
    <template v-if="route.name !== 'session'">
      <PaneDivider v-if="wide" :share="share" @drag="drag" @step="step" @done="done" />
      <div ref="pane" class="pane">
        <SessionPanel :store="store" :route="route" :paned="wide" @go="go" @close="close" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.row {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
}

.chat {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Split, the chat's basis is its share and it may shrink to a floor, as the pane may: a drag
   cannot squash either to nothing, and at the narrowest wide screen the two floors still fit. */
.split > .chat {
  flex: 0 1 calc((100% - var(--divider)) * var(--share));
  min-width: 24rem;
}

.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.split > .pane {
  min-width: 24rem;
}
</style>
