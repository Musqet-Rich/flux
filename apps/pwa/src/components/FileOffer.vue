<script setup lang="ts">
import type { Attachment } from '@flux/protocol';
import { computed, ref } from 'vue';

import type { FetchFile } from './event-view.ts';
import { formatBytes } from './format-bytes.ts';
import Icon from './Icon.vue';

// A file the agent offered (`flux_file_send`, ADR 0036) as a card in the timeline: the image's
// thumbnail where the store has fetched one (the same fetch as a sent image's), else a file
// icon, then the name, the size and the agent's note. Download fetches the whole file through
// `attach.read` and saves it with an `<a download>` on a blob URL; Share, shown only where the
// browser says it can share a file of this type (`navigator.canShare`), hands it to the share
// sheet, which is how a phone saves to Files or sends by AirDrop. The bytes are fetched once
// and kept by the card, so a Share after a Download, or a second tap, does not fetch again.
// A failed fetch shows why with Retry, which repeats what was tapped.

const props = defineProps<{
  file: Attachment;
  note: string;
  thumb: string | null;
  fetchFile: FetchFile;
}>();

type Action = 'download' | 'share';

const fetching = ref(false);
const progress = ref(0);
const error = ref<string | null>(null);
const last = ref<Action>('download');
let blob: Blob | null = null;

// Long enough for the browser to have started reading the blob before its URL goes; the same
// grace FileSaver.js settled on, since revoking at once breaks the save in some browsers.
const revokeAfterMs = 40_000;

const asFile = (data: Blob): File => new File([data], props.file.name, { type: props.file.mime });

const probe = (): boolean => {
  if (!('canShare' in navigator)) return false;
  try {
    return navigator.canShare({ files: [asFile(new Blob([]))] });
  } catch {
    return false;
  }
};
const shareable = probe();

const percent = computed(() => `${Math.round(progress.value * 100)}%`);
const size = computed(() => formatBytes(props.file.size));
// Named per file, so a screen reader's list of regions tells one card from the next.
const label = computed(() => `File from the agent: ${props.file.name}`);

const load = async (): Promise<Blob> => {
  if (blob !== null) return blob;
  fetching.value = true;
  progress.value = 0;
  try {
    blob = await props.fetchFile(props.file, (fraction) => {
      progress.value = fraction;
    });
    return blob;
  } finally {
    fetching.value = false;
  }
};

// Types a browser would run rather than save, were it to open the blob URL instead of
// downloading it: the URL is the app's own origin, and the file is the agent's.
// Whole types only: an Office file's `openxmlformats` type is no script.
const active =
  /^(?:text\/html|application\/xhtml\+xml|(?:text|application)\/xml|image\/svg\+xml|(?:text|application)\/(?:java|ecma)script)$/iu;

const save = (data: Blob): void => {
  const type = active.test(data.type) ? 'application/octet-stream' : data.type;
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = props.file.name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, revokeAfterMs);
};

// What went wrong to show, or null: closing the share sheet is a choice, not an error.
const share = async (data: Blob): Promise<string | null> => {
  try {
    await navigator.share({ files: [asFile(data)], title: props.file.name });
    return null;
  } catch (failure) {
    const name = failure instanceof DOMException ? failure.name : null;
    if (name === 'AbortError') return null;
    // A fetch that took a while can outlast the tap's permission to open the sheet; the bytes
    // are kept now, so the next tap shares at once.
    if (name === 'NotAllowedError') return 'Tap Share again to open the share sheet.';
    const why = failure instanceof Error ? failure.message : String(failure);
    return `Could not share the file: ${why}`;
  }
};

const run = async (action: Action): Promise<void> => {
  if (fetching.value) return;
  last.value = action;
  error.value = null;
  try {
    const data = await load();
    if (action === 'download') save(data);
    else error.value = await share(data);
  } catch (failure) {
    const why = failure instanceof Error ? failure.message : String(failure);
    error.value = `Could not get the file: ${why}`;
  }
};

const download = (): void => {
  void run('download');
};
const shareFile = (): void => {
  void run('share');
};
const retry = (): void => {
  void run(last.value);
};
</script>

<template>
  <section class="offer" :aria-label="label">
    <div class="head">
      <img v-if="thumb !== null" class="thumb" :src="thumb" alt="" />
      <span v-else class="icon"><Icon name="file" /></span>
      <span class="meta">
        <span class="name">{{ file.name }}</span>
        <span class="size">{{ size }}</span>
      </span>
    </div>
    <p v-if="note !== ''" class="note">{{ note }}</p>
    <div class="actions">
      <button type="button" class="download" :disabled="fetching" @click="download">
        <Icon name="download" /> Download
      </button>
      <button
        v-if="shareable"
        type="button"
        class="secondary share"
        :disabled="fetching"
        @click="shareFile"
      >
        <Icon name="share" /> Share
      </button>
    </div>
    <p v-if="fetching" class="progress" role="status">
      <progress :value="progress" max="1" :aria-label="`Fetching ${file.name}`"></progress>
      Fetching… {{ percent }}
    </p>
    <p v-if="error !== null" class="error" role="alert">
      {{ error }}
      <button type="button" class="secondary retry" @click="retry">
        <Icon name="retry" /> Retry
      </button>
    </p>
  </section>
</template>

<style scoped>
.offer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  background: var(--panel-2);
}

.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.thumb {
  max-width: 12rem;
  max-height: 12rem;
  border-radius: 6px;
  display: block;
}

.icon {
  font-size: 1.6rem;
  line-height: 0;
}

.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.size {
  font-size: 0.8rem;
  opacity: 0.7;
}

.note {
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.progress,
.error {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.progress progress {
  flex: 1;
  min-width: 6rem;
}

.error {
  color: var(--danger);
}
</style>
