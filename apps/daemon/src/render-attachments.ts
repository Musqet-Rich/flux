// Renders the files attached to a user message into the text the agent sees (ADR 0020): the
// message, then one line per file with its absolute path on the box, its type and its size,
// so the agent can open any of them with its own tools. Images may also go as content blocks
// (attachment-images.ts); the path line stays either way, so the agent can read the file.

export interface AttachedFile {
  path: string;
  mime: string;
  size: number;
}

const units = ['B', 'KiB', 'MiB', 'GiB'];

const formatSize = (size: number): string => {
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit] ?? 'B'}`;
};

export const renderAttachments = (text: string, files: AttachedFile[]): string => {
  if (files.length === 0) return text;
  const lines = files.map((f) => `Attached: ${f.path} (${f.mime}, ${formatSize(f.size)})`);
  return `${text}\n\n${lines.join('\n')}`;
};
