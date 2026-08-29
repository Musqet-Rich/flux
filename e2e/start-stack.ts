import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2eError } from './e2e-error.ts';
import type { StartedProcess } from './start-process.ts';
import { startProcess } from './start-process.ts';

// The deployed shape on one machine, ephemeral ports, throwaway state: the built relay serving
// the built PWA, the built daemon in a temp data dir with one repository to pick from, and the
// fixture-driven fake `claude` behind it (fake-claude.sh). Pairing goes through the URL that
// `flux pair` prints, as an operator's does.

export interface Stack {
  pwaUrl: string;
  pairingUrl: string;
  // Every line the daemon wrote to the agent's stdin, appended by fake-claude.sh.
  agentStdin: string;
  // The daemon's SQLite file, the event log the timeline is checked against.
  database: string;
  stop: () => Promise<void>;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const relayBin = join(root, 'apps/relay/dist/index.mjs');
const daemonBin = join(root, 'apps/daemon/dist/index.mjs');
const pwaDist = join(root, 'apps/pwa/dist');
const fakeClaude = join(root, 'apps/daemon/test/fake-claude.ts');
const fixture = join(root, 'apps/daemon/test/fixtures/claude/session-two-turns.jsonl');
const shim = join(root, 'e2e/fake-claude.sh');

const run = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new E2eError(`${command} ${args.join(' ')}: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });

// GIT_* from a hook would point every git call at the flux checkout instead of the temp repo.
const baseEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

const requireBuilt = async (): Promise<void> => {
  const files = [relayBin, daemonBin, join(pwaDist, 'index.html')];
  const missing = await Promise.all(
    files.map((file) =>
      access(file).then(
        () => null,
        () => file,
      ),
    ),
  );
  const first = missing.find((file) => file !== null);
  if (first !== undefined) throw new E2eError(`${first} is missing; run \`pnpm run build\` first`);
};

// One repository with one commit, so the new-session screen has something to pick and the
// session's branch has a base to diff against.
const createRepo = async (reposDir: string, env: NodeJS.ProcessEnv): Promise<void> => {
  const repo = join(reposDir, 'demo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'notes.txt'), 'hello\n');
  const git = (args: string[]): Promise<string> =>
    run('git', ['-c', 'user.name=flux', '-c', 'user.email=flux@example.com', ...args], {
      cwd: repo,
      env,
    });
  await git(['init', '-q', '-b', 'main']);
  await git(['add', 'notes.txt']);
  await git(['commit', '-q', '-m', 'notes']);
};

const startRelay = (env: NodeJS.ProcessEnv): Promise<StartedProcess> =>
  startProcess({
    name: 'relay',
    command: process.execPath,
    args: [relayBin],
    env: { ...env, FLUX_RELAY_PORT: '0', FLUX_PWA_DIR: pwaDist },
    ready: /listening on 127\.0\.0\.1:(\d+)$/u,
  });

// Not a terminal, so the daemon prints no QR and mints no secret; `flux pair` does that below.
const startDaemon = (env: NodeJS.ProcessEnv): Promise<StartedProcess> =>
  startProcess({
    name: 'daemon',
    command: process.execPath,
    args: [daemonBin, 'daemon'],
    env,
    ready: /run `flux pair` to pair a device/u,
  });

const pair = async (env: NodeJS.ProcessEnv): Promise<string> => {
  const stdout = await run(process.execPath, [daemonBin, 'pair'], { env });
  const url = /pair a device within 10 minutes: (\S+)/u.exec(stdout)?.[1];
  if (url === undefined) throw new E2eError(`flux pair printed no URL:\n${stdout}`);
  return url;
};

export const startStack = async (label: string): Promise<Stack> => {
  await requireBuilt();
  const dir = await mkdtemp(join(tmpdir(), `flux-e2e-${label}-`));
  const reposDir = join(dir, 'repos');
  const dataDir = join(dir, 'data');
  const env = baseEnv();
  await createRepo(reposDir, env);
  const relay = await startRelay(env);
  const pwaUrl = `http://127.0.0.1:${relay.match[1] ?? ''}`;
  const agentStdin = join(dir, 'agent-stdin.jsonl');
  const daemonEnv = {
    ...env,
    HOME: dir,
    FLUX_RELAY_URL: pwaUrl,
    FLUX_DATA_DIR: dataDir,
    FLUX_REPOS_DIR: reposDir,
    FLUX_CLAUDE: shim,
    FLUX_FAKE_FIXTURE: fixture,
    FLUX_E2E_FAKE_CLAUDE: fakeClaude,
    FLUX_E2E_AGENT_STDIN: agentStdin,
    FLUX_E2E_NODE: process.execPath,
  };
  const daemon = await startDaemon(daemonEnv);
  const pairingUrl = await pair(daemonEnv);
  return {
    pwaUrl,
    pairingUrl,
    agentStdin,
    database: join(dataDir, 'flux.sqlite'),
    stop: async () => {
      await daemon.stop();
      await relay.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
};
