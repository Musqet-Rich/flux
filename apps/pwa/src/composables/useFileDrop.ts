import { guards } from '@flux/protocol';
import type { Ref } from 'vue';
import { onMounted, onScopeDispose, ref } from 'vue';

// Files dropped on the bottom bar (the composer and the status bar under it) are handed to
// `onFiles`; a drop anywhere else on the page is swallowed, so a stray drop does not navigate
// the tab away to the file. Listens on the document, since the browser fires `dragover` on
// whatever is under the pointer and the default (navigate) must be cancelled everywhere.
// `over` is true while a drag hovers the bar, for the highlight; the bar's elements also get
// a `drop-target` class, since the status bar is another component's. Only a drag carrying
// files is handled: a text selection dragged inside the editor stays the editor's.

export interface FileDrop {
  over: Ref<boolean>;
  // Reads the files out of a drop or paste event; empty when it carries none.
  filesOf: (event: Event) => File[];
}

const { isRecord, isInteger } = guards;

// A FileList, or an array a test hands over.
const isArrayLike = (v: unknown): v is ArrayLike<unknown> =>
  Array.isArray(v) || (isRecord(v) && isInteger(v['length']));

// `dataTransfer` (drop) or `clipboardData` (paste), read structurally: neither DragEvent nor
// DataTransfer is guaranteed by every environment this runs in.
const filesOf = (event: Event): File[] => {
  const transfer =
    'dataTransfer' in event
      ? event.dataTransfer
      : 'clipboardData' in event
        ? event.clipboardData
        : null;
  if (!isRecord(transfer) || !isArrayLike(transfer['files'])) return [];
  return Array.from(transfer['files']).filter((f) => f instanceof File);
};

// Whether a drag brings files: `dataTransfer.types` names `Files` for one, a text drag not.
const carriesFiles = (event: Event): boolean => {
  if (!('dataTransfer' in event) || !isRecord(event.dataTransfer)) return false;
  const types = event.dataTransfer['types'];
  return isArrayLike(types) && Array.from(types).includes('Files');
};

export const useFileDrop = (
  bar: () => (Element | null)[],
  onFiles: (files: File[]) => void,
  doc: Document = document,
): FileDrop => {
  const over = ref(false);
  const onBar = (event: Event): boolean => {
    const { target } = event;
    return target instanceof Node && bar().some((el) => el !== null && el.contains(target));
  };
  const mark = (on: boolean): void => {
    over.value = on;
    for (const el of bar()) el?.classList.toggle('drop-target', on);
  };
  const onDragOver = (event: Event): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const inside = onBar(event);
    if ('dataTransfer' in event && isRecord(event.dataTransfer)) {
      event.dataTransfer['dropEffect'] = inside ? 'copy' : 'none';
    }
    mark(inside);
  };
  const onDragLeave = (event: Event): void => {
    if (!onBar(event)) mark(false);
  };
  const onDrop = (event: Event): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const inside = onBar(event);
    mark(false);
    if (!inside) return;
    const files = filesOf(event);
    if (files.length > 0) onFiles(files);
  };
  onMounted(() => {
    doc.addEventListener('dragover', onDragOver);
    doc.addEventListener('dragleave', onDragLeave);
    doc.addEventListener('drop', onDrop);
  });
  onScopeDispose(() => {
    doc.removeEventListener('dragover', onDragOver);
    doc.removeEventListener('dragleave', onDragLeave);
    doc.removeEventListener('drop', onDrop);
    mark(false);
  });
  return { over, filesOf };
};
