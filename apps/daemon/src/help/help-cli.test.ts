import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// The `flux help [term]` CLI seam end to end: the real index.ts run under Node with a `help`
// command. It must print the bundled manual and exit 0 WITHOUT a relay URL — proof it short-circuits
// before createDaemon (a fall-through would construct a daemon and exit non-zero). Mirrors
// flux-mcp.test.ts, which spawns its source .ts entry directly, and passes no FLUX_RELAY_URL.

const entry = fileURLToPath(new URL('../index.ts', import.meta.url));

interface Result {
  code: number | null;
  stdout: string;
}

const runHelpCli = (args: string[]): Promise<Result> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('close', (code) => {
      resolve({ code, stdout });
    });
  });

test('`flux help` prints the overview and topics and exits 0 with no relay URL', async () => {
  const result = await runHelpCli(['help']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Topics');
  expect(result.stdout).toContain('Pairing a device');
});

test('`flux help <term>` prints the matching section and exits 0', async () => {
  const result = await runHelpCli(['help', 'how', 'do', 'I', 'pair']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('# Pairing a device');
});
