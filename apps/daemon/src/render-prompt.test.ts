import { expect, test } from 'vitest';

import { renderPrompt } from './render-prompt.ts';

test('quote first, then the message, the referenced code and the attached files', () => {
  const out = renderPrompt({
    text: 'fix it',
    refs: [{ path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 1 } }],
    contents: ['const a = 1;'],
    reply: { seq: 2, from: 'assistant', text: 'Done?' },
    attachments: [{ path: '/d/s/1-shot.png', mime: 'image/png', size: 75 }],
  });
  expect(out).toBe(
    [
      'In reply to your earlier message:',
      '',
      '> Done?',
      '',
      'fix it',
      '',
      '```a.ts:1-1',
      'const a = 1;',
      '```',
      '',
      'Attached: /d/s/1-shot.png (image/png, 75 B)',
    ].join('\n'),
  );
});

test('a bare message is passed through', () => {
  expect(renderPrompt({ text: 'hi', refs: [], contents: [], reply: null, attachments: [] })).toBe(
    'hi',
  );
});
