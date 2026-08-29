// Block-level pass of the timeline's Markdown renderer: text in, a flat list of blocks out.
// Deliberately partial (see render-markdown.ts): paragraphs, `#`–`###` headings, fenced code,
// `>` quotes, pipe tables and one level of nested list. Anything else is a paragraph line. The output is
// data only; nothing here interprets HTML, and an unclosed fence at the end of the text (the
// streaming case) is a code block with `closed: false` rather than a fallback to raw text.

export interface MarkdownParagraph {
  kind: 'paragraph';
  lines: string[];
}

export interface MarkdownHeading {
  kind: 'heading';
  level: number;
  text: string;
}

export interface MarkdownCode {
  kind: 'code';
  lang: string;
  text: string;
  closed: boolean;
}

export interface MarkdownQuote {
  kind: 'quote';
  lines: string[];
}

export interface MarkdownListItem {
  lines: string[];
  nested: MarkdownList | null;
}

export interface MarkdownList {
  kind: 'list';
  ordered: boolean;
  items: MarkdownListItem[];
}

export type MarkdownAlign = 'left' | 'center' | 'right' | null;

export interface MarkdownTable {
  kind: 'table';
  align: MarkdownAlign[];
  header: string[];
  rows: string[][];
}

export type MarkdownBlock =
  | MarkdownParagraph
  | MarkdownHeading
  | MarkdownCode
  | MarkdownQuote
  | MarkdownList
  | MarkdownTable;

interface Read {
  block: MarkdownBlock;
  next: number;
}

const fenceRe = /^\s{0,3}```\s*([\w+#.-]*)\s*$/u;
const headingRe = /^(#{1,3})\s+(.*?)\s*#*\s*$/u;
const itemRe = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/u;
const quoteRe = /^\s{0,3}>\s?(.*)$/u;
const delimiterRe = /^\s{0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/u;

const lineAt = (lines: string[], index: number): string => lines[index] ?? '';
const isBlank = (line: string): boolean => line.trim() === '';
// Cells are split on `|` unless escaped as `\|`; the outer pipes are optional (GFM).
const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/u, '')
    .replace(/(?<!\\)\|$/u, '')
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));

// A table starts with a header row and a `---` delimiter row with the same cell count.
const startsTable = (lines: string[], index: number): boolean => {
  const head = lineAt(lines, index);
  const delimiter = lineAt(lines, index + 1);
  return (
    head.includes('|') &&
    delimiterRe.test(delimiter) &&
    cells(head).length === cells(delimiter).length
  );
};

const startsBlock = (line: string): boolean =>
  fenceRe.test(line) || headingRe.test(line) || itemRe.test(line) || quoteRe.test(line);

const readFence = (lines: string[], start: number): Read => {
  const lang = fenceRe.exec(lineAt(lines, start))?.[1] ?? '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lineAt(lines, i);
    if (/^\s{0,3}```\s*$/u.test(line)) {
      return { block: { kind: 'code', lang, text: body.join('\n'), closed: true }, next: i + 1 };
    }
    body.push(line);
  }
  return {
    block: { kind: 'code', lang, text: body.join('\n'), closed: false },
    next: lines.length,
  };
};

const readQuote = (lines: string[], start: number): Read => {
  const body: string[] = [];
  let i = start;
  for (; i < lines.length; i += 1) {
    const match = quoteRe.exec(lineAt(lines, i));
    if (match === null) break;
    body.push(match[1] ?? '');
  }
  return { block: { kind: 'quote', lines: body }, next: i };
};

const alignOf = (cell: string): MarkdownAlign => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
};

// Rows run until a blank line or another block; short rows are padded, long rows trimmed, so
// every row has the header's width.
const readTable = (lines: string[], start: number): Read => {
  const header = cells(lineAt(lines, start));
  const align = cells(lineAt(lines, start + 1)).map((cell) => alignOf(cell));
  const rows: string[][] = [];
  let i = start + 2;
  for (; i < lines.length; i += 1) {
    const line = lineAt(lines, i);
    if (isBlank(line) || startsBlock(line)) break;
    const row = cells(line).slice(0, header.length);
    while (row.length < header.length) row.push('');
    rows.push(row);
  }
  return { block: { kind: 'table', align, header, rows }, next: i };
};

const readParagraph = (lines: string[], start: number): Read => {
  const body = [lineAt(lines, start)];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const line = lineAt(lines, i);
    if (isBlank(line) || startsBlock(line) || startsTable(lines, i)) break;
    body.push(line);
  }
  return { block: { kind: 'paragraph', lines: body }, next: i };
};

const orderedMarker = (line: string): boolean => /^\s*\d+\./u.test(line);

// A blank line ends the list unless the next non-blank line is another item at any level.
const continuesAfterBlank = (lines: string[], index: number): boolean =>
  index + 1 < lines.length && itemRe.test(lineAt(lines, index + 1));

const readList = (lines: string[], start: number): Read => {
  const list: MarkdownList = {
    kind: 'list',
    ordered: orderedMarker(lineAt(lines, start)),
    items: [],
  };
  let i = start;
  for (; i < lines.length; i += 1) {
    const line = lineAt(lines, i);
    const match = itemRe.exec(line);
    const last = list.items.at(-1);
    if (match !== null) {
      const indent = (match[1] ?? '').length;
      const text = match[2] ?? '';
      if (indent >= 2 && last !== undefined) {
        last.nested ??= { kind: 'list', ordered: orderedMarker(line), items: [] };
        last.nested.items.push({ lines: [text], nested: null });
      } else if (orderedMarker(line) === list.ordered) {
        list.items.push({ lines: [text], nested: null });
      } else break;
    } else if (isBlank(line)) {
      if (!continuesAfterBlank(lines, i)) break;
    } else if (last === undefined || startsBlock(line) || startsTable(lines, i)) break;
    else (last.nested?.items.at(-1) ?? last).lines.push(line.trim());
  }
  return { block: list, next: i };
};

const readBlock = (lines: string[], start: number): Read => {
  const line = lineAt(lines, start);
  if (fenceRe.test(line)) return readFence(lines, start);
  const heading = headingRe.exec(line);
  if (heading !== null) {
    const level = (heading[1] ?? '#').length;
    return { block: { kind: 'heading', level, text: heading[2] ?? '' }, next: start + 1 };
  }
  if (itemRe.test(line)) return readList(lines, start);
  if (quoteRe.test(line)) return readQuote(lines, start);
  if (startsTable(lines, start)) return readTable(lines, start);
  return readParagraph(lines, start);
};

export const tokeniseMarkdown = (text: string): MarkdownBlock[] => {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lineAt(lines, i))) {
      i += 1;
      continue;
    }
    const read = readBlock(lines, i);
    blocks.push(read.block);
    i = read.next;
  }
  return blocks;
};
