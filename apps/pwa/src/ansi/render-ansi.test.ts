import type { VNode } from 'vue';
import { expect, test } from 'vitest';

import { renderAnsi } from './render-ansi.ts';

// The renderer builds a wrapping <span class="ansi"> whose children are plain strings for
// unstyled runs and styled <span>s for coloured runs, mirroring the Markdown renderer. These
// tests read the VNode tree it hands Vue, so no DOM is needed.

const E = '\u001B';
const BEL = '\u0007';

const children = (text: string): unknown[] => renderAnsi(text).children as unknown[];

const styleOf = (node: unknown): Record<string, string> =>
  ((node as VNode).props?.['style'] as Record<string, string> | undefined) ?? {};

test('plain text becomes a single string child, no spans', () => {
  expect(children('hello world')).toEqual(['hello world']);
});

test('a foreground colour becomes a styled span, and reset returns to plain text', () => {
  const kids = children(`${E}[31mred${E}[0m tail`);
  expect(kids).toHaveLength(2);
  expect(styleOf(kids[0])).toMatchObject({ color: '#f7768e' });
  expect((kids[0] as VNode).children).toBe('red');
  expect(kids[1]).toBe(' tail');
});

test('bold sets a weight and 22 clears it', () => {
  const kids = children(`${E}[1mB${E}[22mN`);
  expect(styleOf(kids[0])).toMatchObject({ fontWeight: 'bold' });
  expect(kids[1]).toBe('N');
});

test('a 256-colour code maps through the cube', () => {
  const kids = children(`${E}[38;5;196mX`);
  expect(styleOf(kids[0])).toMatchObject({ color: 'rgb(255, 0, 0)' });
});

test('a truecolor code maps to rgb()', () => {
  const kids = children(`${E}[38;2;10;20;30mX`);
  expect(styleOf(kids[0])).toMatchObject({ color: 'rgb(10, 20, 30)' });
});

test('a non-SGR CSI sequence is stripped, its text kept', () => {
  expect(children(`${E}[2Jcleared`)).toEqual(['cleared']);
});

test('an OSC sequence (title set) is stripped through its BEL terminator', () => {
  expect(children(`${E}]0;title${BEL}text`)).toEqual(['text']);
});
