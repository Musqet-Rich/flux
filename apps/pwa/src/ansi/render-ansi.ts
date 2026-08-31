import type { VNode, VNodeChild } from 'vue';
import { h } from 'vue';

// Renders a command's output with its ANSI SGR colour intact (ADR 0026). There is no PTY, so the
// child ran with FORCE_COLOR=1 and emits real escape codes; this turns the colour ones into styled
// <span>s the way the Markdown renderer builds VNodes with `h()` — no dependency, no `v-html`, so
// the text only ever becomes text nodes. Non-colour escapes (cursor moves, OSC, …) are stripped.

interface Sgr {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const blank: Sgr = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };

const ESC = '\u001B';

// A readable 16-colour palette for the dark app (the eight normal then eight bright slots).
const palette: readonly string[] = [
  '#3b4048',
  '#f7768e',
  '#9ece6a',
  '#e0af68',
  '#7aa2f7',
  '#bb9af7',
  '#7dcfff',
  '#c0caf5',
  '#565f89',
  '#ff9eb1',
  '#b9f27c',
  '#f0c987',
  '#9db9ff',
  '#d2bbff',
  '#a0e0ff',
  '#ffffff',
];

const rgb = (r: number, g: number, b: number): string => `rgb(${r}, ${g}, ${b})`;

// An xterm 256-colour index to a CSS colour: the first 16 from the palette, then the 6×6×6 cube,
// then the 24-step greyscale ramp.
const cubeStep = (n: number): number => (n === 0 ? 0 : 55 + n * 40);
const xterm256 = (n: number): string => {
  if (n < 16) return palette[n] ?? '#c0caf5';
  if (n > 231) {
    const v = 8 + (n - 232) * 10;
    return rgb(v, v, v);
  }
  const c = n - 16;
  return rgb(cubeStep(Math.floor(c / 36) % 6), cubeStep(Math.floor(c / 6) % 6), cubeStep(c % 6));
};

// `38`/`48` introduce an extended colour: `5;n` (256-colour) or `2;r;g;b` (truecolor). Returns the
// index of the last param it consumed, so the caller resumes after it.
const extended = (style: Sgr, params: number[], i: number, ground: 'fg' | 'bg'): number => {
  if (params[i + 1] === 5 && params[i + 2] !== undefined) {
    style[ground] = xterm256(params[i + 2] ?? 0);
    return i + 2;
  }
  if (params[i + 1] === 2 && params[i + 4] !== undefined) {
    style[ground] = rgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
    return i + 4;
  }
  return i;
};

const applyOne = (style: Sgr, params: number[], i: number, code: number): number => {
  if (code === 0) Object.assign(style, blank);
  else if (code === 1) style.bold = true;
  else if (code === 2) style.dim = true;
  else if (code === 3) style.italic = true;
  else if (code === 4) style.underline = true;
  else if (code === 22) {
    style.bold = false;
    style.dim = false;
  } else if (code === 23) style.italic = false;
  else if (code === 24) style.underline = false;
  else if (code === 39) style.fg = null;
  else if (code === 49) style.bg = null;
  else if (code >= 30 && code <= 37) style.fg = palette[code - 30] ?? null;
  else if (code >= 90 && code <= 97) style.fg = palette[code - 82] ?? null;
  else if (code >= 40 && code <= 47) style.bg = palette[code - 40] ?? null;
  else if (code >= 100 && code <= 107) style.bg = palette[code - 92] ?? null;
  else if (code === 38 || code === 48) return extended(style, params, i, code === 38 ? 'fg' : 'bg');
  return i;
};

const applyCodes = (base: Sgr, params: number[]): Sgr => {
  const style = { ...base };
  let i = 0;
  while (i < params.length) {
    i = applyOne(style, params, i, params[i] ?? 0) + 1;
  }
  return style;
};

const parseParams = (body: string): number[] =>
  body.split(';').map((part) => {
    const n = part === '' ? 0 : Math.trunc(Number(part));
    return Number.isNaN(n) ? 0 : n;
  });

// The final byte of a CSI sequence is 0x40–0x7E; the bytes before it are its parameters. -1 when
// the sequence is not terminated within the text (a chunk split mid-escape).
const csiEnd = (text: string, from: number): number => {
  let i = from;
  while (i < text.length) {
    const c = text.codePointAt(i) ?? 0;
    if (c >= 0x40 && c <= 0x7e) return i;
    i += 1;
  }
  return -1;
};

// A non-CSI escape is dropped: an OSC (`ESC ]`) runs to its BEL or ST terminator, anything else is
// a two-byte escape.
const skipEscape = (text: string, i: number): number => {
  if (text.charAt(i + 1) !== ']') return i + 2;
  let j = i + 2;
  while (j < text.length && text.charAt(j) !== '\u0007' && text.charAt(j) !== ESC) j += 1;
  return text.charAt(j) === ESC ? j + 2 : j + 1;
};

interface Run {
  text: string;
  style: Sgr;
}

const parseAnsi = (text: string): Run[] => {
  const runs: Run[] = [];
  let style = blank;
  let plain = '';
  let i = 0;
  const flush = (): void => {
    if (plain !== '') runs.push({ text: plain, style });
    plain = '';
  };
  while (i < text.length) {
    if (text.charAt(i) === ESC && text.charAt(i + 1) === '[') {
      const end = csiEnd(text, i + 2);
      if (end !== -1) {
        flush();
        if (text.charAt(end) === 'm')
          style = applyCodes(style, parseParams(text.slice(i + 2, end)));
        i = end + 1;
        continue;
      }
    }
    if (text.charAt(i) === ESC) {
      flush();
      i = skipEscape(text, i);
      continue;
    }
    plain += text.charAt(i);
    i += 1;
  }
  flush();
  return runs;
};

const styleOf = (s: Sgr): Record<string, string> => {
  const css: Record<string, string> = {};
  if (s.fg !== null) css['color'] = s.fg;
  if (s.bg !== null) css['backgroundColor'] = s.bg;
  if (s.bold) css['fontWeight'] = 'bold';
  if (s.dim) css['opacity'] = '0.6';
  if (s.italic) css['fontStyle'] = 'italic';
  if (s.underline) css['textDecoration'] = 'underline';
  return css;
};

const runNode = (run: Run): VNodeChild => {
  const css = styleOf(run.style);
  return Object.keys(css).length === 0 ? run.text : h('span', { style: css }, run.text);
};

export const renderAnsi = (text: string): VNode =>
  h(
    'span',
    { class: 'ansi' },
    parseAnsi(text).map((run) => runNode(run)),
  );
