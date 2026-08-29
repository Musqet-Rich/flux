import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import type { AgentProcess } from '../src/claude/spawn-claude.ts';
import { piExtensionPath } from '../src/pi/pi-extension-path.ts';
import { spawnPi } from '../src/pi/spawn-pi.ts';

// Opt-in: the real pi, one tiny prompt, real money. FLUX_LIVE_PI=1 turns it on; FLUX_PI,
// FLUX_PI_PROVIDER and FLUX_PI_MODEL pick the binary, provider and model as for the daemon.
// It proves the arguments spawn-pi.ts passes are still accepted and the stream still parses.

const env = process.env;
const live = env['FLUX_LIVE_PI'] === '1';
const options = (dataDir: string): Parameters<typeof spawnPi>[0] => ({
  cwd: dataDir,
  session: crypto.randomUUID(),
  sessionDir: join(dataDir, 'sessions'),
  extension: piExtensionPath(),
  ...(env['FLUX_PI'] === undefined ? {} : { command: env['FLUX_PI'] }),
  ...(env['FLUX_PI_PROVIDER'] === undefined ? {} : { provider: env['FLUX_PI_PROVIDER'] }),
  ...(env['FLUX_PI_MODEL'] === undefined ? {} : { model: env['FLUX_PI_MODEL'] }),
});

// Collects lines until the run settles.
const run = (agent: AgentProcess): Promise<string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    agent.onLine((line) => {
      lines.push(line);
      if (line.includes('"agent_settled"')) resolve(lines);
    });
  });

const finishedAssistant = (line: string): boolean =>
  line.includes('"role":"assistant"') && line.includes('"stopReason":"stop"');

test.runIf(live)(
  'the real pi answers a prompt in rpc mode with the Flux extension loaded',
  async () => {
    const agent = spawnPi(options(mkdtempSync(join(tmpdir(), 'flux-live-pi-'))));
    const settled = run(agent);
    agent.send('Reply with exactly the word: pong');
    const lines = await settled;
    expect(await agent.close()).toBe(0);
    expect(lines[0]).toContain('"command":"prompt","success":true');
    expect(lines.some((l) => l.includes('"text_delta"'))).toBe(true);
    expect(lines.some((l) => finishedAssistant(l))).toBe(true);
  },
  120_000,
);
