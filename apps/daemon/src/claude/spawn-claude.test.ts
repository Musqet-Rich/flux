import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import type { AgentProcess } from './spawn-claude.ts';
import { spawnClaude } from './spawn-claude.ts';

// The process boundary is mocked with a fixture-replaying script (engineering.md § Testing);
// everything on this side of it is real.

const fake = fileURLToPath(new URL('../../test/fake-claude.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../test/fixtures/claude/session-two-turns.jsonl', import.meta.url),
);

const stubborn = fileURLToPath(new URL('../../test/stubborn-agent.ts', import.meta.url));
const echo = fileURLToPath(new URL('../../test/echo-agent.ts', import.meta.url));
const png = fileURLToPath(new URL('../../test/red.png', import.meta.url));
const imageMeta = fileURLToPath(
  new URL('../../test/fixtures/claude/session-image-block.meta.json', import.meta.url),
);

const start = (extra: NodeJS.ProcessEnv = {}, command = fake): AgentProcess =>
  spawnClaude({
    cwd: process.cwd(),
    command,
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, ...extra },
    close: { graceMs: 100 },
  });

// Collects lines until a `result` line arrives, which ends a turn.
const turn = (agent: AgentProcess): Promise<string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    agent.onLine((line) => {
      lines.push(line);
      if (line.includes('"type":"result"')) resolve(lines.splice(0));
    });
  });

test('replays one fixture turn per user message and exits cleanly on close', async () => {
  const agent = start();
  const first = turn(agent);
  agent.send('first');
  const lines = await first;
  expect(lines.some((l) => l.includes('"subtype":"init"'))).toBe(true);
  expect(lines.at(-1)).toContain('"type":"result"');
  expect(await agent.close()).toBe(0);
});

test('reports an unexpected exit', async () => {
  const agent = start({ FLUX_FAKE_EXIT_AFTER_TURNS: '1' });
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  agent.send('go');
  expect(await exit).toBe(1);
  expect(await agent.close()).toBe(1);
});

// The stubborn agent prints `ready` once its SIGTERM handler is installed.
const ready = (agent: AgentProcess): Promise<string> =>
  new Promise((resolve) => {
    agent.onLine(resolve);
  });

// An agent blocked inside an MCP call ignores stdin EOF and SIGTERM; kill is SIGKILL of its
// group and does not wait, close escalates to it and still returns.
test('kill ends an agent that ignores SIGTERM', async () => {
  const agent = start({}, stubborn);
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  expect(await ready(agent)).toBe('ready');
  agent.kill();
  expect(await exit).toBeNull();
});

test('close ends an agent that ignores EOF and SIGTERM', async () => {
  const agent = start({}, stubborn);
  const exit = new Promise<number | null>((resolve) => {
    agent.onExit(resolve);
  });
  expect(await ready(agent)).toBe('ready');
  expect(await agent.close()).toBeNull();
  expect(await exit).toBeNull();
});

// Args are recorded by the fake at startup; drive one turn so the process is up and has written
// them before reading, then close it.
const argsOf = async (agent: AgentProcess, file: string): Promise<string[]> => {
  const done = turn(agent);
  agent.send('go');
  await done;
  const args = JSON.parse(readFileSync(file, 'utf8')) as string[];
  await agent.close();
  return args;
};

test('passes --model and --effort when set, and omits them when unset', async () => {
  const flaggedFile = join(tmpdir(), `flux-claude-args-set-${process.pid}.json`);
  const flagged = spawnClaude({
    cwd: process.cwd(),
    command: fake,
    model: 'opus',
    effort: 'high',
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, FLUX_FAKE_ARGS_FILE: flaggedFile },
    close: { graceMs: 100 },
  });
  const args = await argsOf(flagged, flaggedFile);
  expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
    '--model',
    'opus',
  ]);
  expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
    '--effort',
    'high',
  ]);
  const plainFile = join(tmpdir(), `flux-claude-args-bare-${process.pid}.json`);
  const plain = await argsOf(start({ FLUX_FAKE_ARGS_FILE: plainFile }), plainFile);
  expect(plain).not.toContain('--model');
  expect(plain).not.toContain('--effort');
});

test('compiles the tool policy to flags: deny disallows, none is --tools "", all omits', async () => {
  const denyFile = join(tmpdir(), `flux-claude-args-deny-${process.pid}.json`);
  const deny = spawnClaude({
    cwd: process.cwd(),
    command: fake,
    tools: { mode: 'deny', list: ['Bash', 'Edit'] },
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, FLUX_FAKE_ARGS_FILE: denyFile },
    close: { graceMs: 100 },
  });
  const denied = await argsOf(deny, denyFile);
  expect(
    denied.slice(denied.indexOf('--disallowedTools'), denied.indexOf('--disallowedTools') + 2),
  ).toEqual(['--disallowedTools', 'Bash,Edit']);
  expect(denied).not.toContain('--tools');
  const noneFile = join(tmpdir(), `flux-claude-args-none-${process.pid}.json`);
  const none = spawnClaude({
    cwd: process.cwd(),
    command: fake,
    tools: { mode: 'none' },
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, FLUX_FAKE_ARGS_FILE: noneFile },
    close: { graceMs: 100 },
  });
  const noneArgs = await argsOf(none, noneFile);
  expect(noneArgs.slice(noneArgs.indexOf('--tools'), noneArgs.indexOf('--tools') + 2)).toEqual([
    '--tools',
    '',
  ]);
  const allFile = join(tmpdir(), `flux-claude-args-all-${process.pid}.json`);
  const all = await argsOf(start({ FLUX_FAKE_ARGS_FILE: allFile }), allFile);
  expect(all).not.toContain('--tools');
  expect(all).not.toContain('--disallowedTools');
});

test('appends role after the flux prompt in --append-system-prompt, never replacing it', async () => {
  const withRoleFile = join(tmpdir(), `flux-claude-args-role-${process.pid}.json`);
  const withRole = spawnClaude({
    cwd: process.cwd(),
    command: fake,
    mcpConfig: '/tmp/flux-mcp.json',
    role: 'You write terse TypeScript.',
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, FLUX_FAKE_ARGS_FILE: withRoleFile },
    close: { graceMs: 100 },
  });
  const args = await argsOf(withRole, withRoleFile);
  const prompt = args[args.indexOf('--append-system-prompt') + 1];
  expect(prompt).toMatch(/^You are running unattended under Flux\./u);
  expect(prompt).toMatch(/\n\nYou write terse TypeScript\.$/u);
  // The MCP tools floor is untouched.
  expect(args.slice(args.indexOf('--mcp-config'), args.indexOf('--mcp-config') + 2)).toEqual([
    '--mcp-config',
    '/tmp/flux-mcp.json',
  ]);
  // With no role, the append-system-prompt is the flux prompt alone.
  const noRoleFile = join(tmpdir(), `flux-claude-args-norole-${process.pid}.json`);
  const noRole = spawnClaude({
    cwd: process.cwd(),
    command: fake,
    mcpConfig: '/tmp/flux-mcp.json',
    env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, FLUX_FAKE_ARGS_FILE: noRoleFile },
    close: { graceMs: 100 },
  });
  const bare = await argsOf(noRole, noRoleFile);
  expect(bare[bare.indexOf('--append-system-prompt') + 1]).not.toMatch(/terse/u);
});

// The message with an image block is written exactly as the capture that produced
// fixtures/claude/session-image-block was fed (its meta.json records the input; the real
// binary answered from the image), so the shape the daemon sends is the one verified to work.
test('images go with the text as content blocks, in the shape the real binary accepted', async () => {
  const agent = start({}, echo);
  const line = new Promise<string>((resolve) => {
    agent.onLine(resolve);
  });
  const data = (await readFile(png)).toString('base64');
  agent.send('What colour?', [{ mediaType: 'image/png', data }]);
  const sent = JSON.parse(await line) as { message: { content: { type: string }[] } };
  await agent.close();
  expect(sent).toEqual({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'What colour?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
      ],
    },
  });
  const meta = JSON.parse(await readFile(imageMeta, 'utf8')) as {
    input: { message: { content: { type: string }[] } };
  };
  expect(sent.message.content.map((b) => b.type)).toEqual(
    meta.input.message.content.map((b) => b.type),
  );
});
