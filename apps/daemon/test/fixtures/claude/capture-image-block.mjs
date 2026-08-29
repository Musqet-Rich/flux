// Captures a real `claude -p --input-format stream-json` run that is sent one user message
// whose content is a text block plus an image block, so the daemon's image-attachment path is
// verified against the real binary (engineering.md § Testing: fixtures, never hand-edited).
// Usage: node capture.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir = '.'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const cwd = new URL('./work/', import.meta.url).pathname;
const png = readFileSync(new URL('./red.png', import.meta.url)).toString('base64');

const args = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
  '--model',
  'claude-haiku-4-5',
  '--setting-sources',
  'project',
  '--disable-slash-commands',
];
const child = spawn(process.env.FLUX_CLAUDE ?? 'claude', args, {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', MAX_THINKING_TOKENS: '0' },
});
let out = '';
let err = '';
child.stdout.on('data', (c) => {
  out += c;
});
child.stderr.on('data', (c) => {
  err += c;
});
const text =
  'What single colour is the attached image? Answer with just the colour word, nothing else.\n\nAttached: ' +
  join(cwd, 'red.png') +
  ' (image/png, 75 B)';
const message = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
    ],
  },
};
child.stdin.write(`${JSON.stringify(message)}\n`);
child.stdout.on('data', () => {
  if (out.includes('"type":"result"')) child.stdin.end();
});
child.on('exit', (code, signal) => {
  writeFileSync(join(outDir, 'session-image-block.jsonl'), out);
  writeFileSync(join(outDir, 'session-image-block.stderr.txt'), err);
  writeFileSync(
    join(outDir, 'session-image-block.meta.json'),
    JSON.stringify(
      {
        code,
        signal,
        args,
        agent: 'Claude Code',
        version: '2.1.251',
        capturedAt: '2026-08-29',
        input: {
          ...message,
          message: {
            ...message.message,
            content: [
              message.message.content[0],
              {
                ...message.message.content[1],
                source: {
                  ...message.message.content[1].source,
                  data: `<${png.length} base64 chars of an 8x8 red PNG>`,
                },
              },
            ],
          },
        },
        source:
          'Raw stdout of one `claude -p` run given a single stream-json user message whose content is a text block followed by a base64 image block (an 8x8 solid red PNG, test/red.png), exactly as the daemon sends an image attachment (spawn-claude.ts). The reply names the colour, which shows the image block was accepted and seen. Captured by scratch capture.mjs; nothing edited.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('exit', code, signal, 'stdout bytes', out.length);
});
