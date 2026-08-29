import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2eError } from './e2e-error.ts';
import type { StartedProcess } from './start-process.ts';
import { startProcess } from './start-process.ts';
import { sweepStale } from './sweep-stale.ts';

// The deployed shape on one machine, ephemeral ports, throwaway state: the built relay serving
// the built PWA, the built daemon in a temp data dir with one repository to pick from, and the
// fixture-driven fake `claude` behind it (fake-claude.sh). Pairing goes through the URL that
// `flux pair` prints, as an operator's does. Whatever ends this process (a finished run, an
// error, Ctrl-C) takes the relay, the daemon and the temp dir with it.

export interface Stack {
  pwaUrl: string;
  pairingUrl: string;
  // A fresh single-use pairing URL, for a second device or a wiped one.
  pair: () => Promise<string>;
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
const defaultFixture = join(root, 'apps/daemon/test/fixtures/claude/session-two-turns.jsonl');
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

// The operator's own git and shell configuration stay out of it: GIT_* from a hook would point
// every git call at the flux checkout, and a global gitconfig (signing, hooks, aliases) would
// shape the temp repository. HOME and XDG_CONFIG_HOME (git reads $XDG_CONFIG_HOME/git/config
// too) are the temp dir for every child.
const isolatedEnv = (home: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  HOME: home,
  XDG_CONFIG_HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
});

// A pidfile per child in the temp dir, so a run that finds this dir left behind can kill the
// group (sweep-stale.ts) instead of only removing the files.
const pidfile = (dir: string, name: string, child: StartedProcess): Promise<void> =>
  writeFile(join(dir, `${name}.pid`), `${child.pid}\n`);

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

// Not a terminal, so the daemon prints no QR and mints no secret; `flux pair` does that.
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

// Whatever this process dies of, the children and the temp dir go too: `exit` covers a normal
// end and an uncaught error; Ctrl-C reaches the worker as SIGINT, which would otherwise leave
// the daemon and relay running and the dir behind.
const attachCleanup = (children: StartedProcess[], dir: string): (() => void) => {
  const cleanup = (): void => {
    for (const child of children) child.killNow();
    rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = (): void => {
    cleanup();
    process.exit(130);
  };
  process.once('exit', cleanup);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    process.off('exit', cleanup);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
};

// `fixture` is the capture the fake agent replays, one turn per message sent to it.
export const startStack = async (label: string, fixture = defaultFixture): Promise<Stack> => {
  await requireBuilt();
  for (const swept of sweepStale()) process.stderr.write(`[e2e] swept stale ${swept}\n`);
  const dir = await mkdtemp(join(tmpdir(), `flux-e2e-${label}-`));
  const reposDir = join(dir, 'repos');
  const dataDir = join(dir, 'data');
  const env = isolatedEnv(dir);
  await createRepo(reposDir, env);
  const children: StartedProcess[] = [];
  const detach = attachCleanup(children, dir);
  const relay = await startRelay(env);
  children.push(relay);
  await pidfile(dir, 'relay', relay);
  const pwaUrl = `http://127.0.0.1:${relay.match[1] ?? ''}`;
  const agentStdin = join(dir, 'agent-stdin.jsonl');
  const daemonEnv = {
    ...env,
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
  children.push(daemon);
  await pidfile(dir, 'daemon', daemon);
  return {
    pwaUrl,
    pairingUrl: await pair(daemonEnv),
    pair: () => pair(daemonEnv),
    agentStdin,
    database: join(dataDir, 'flux.sqlite'),
    stop: async () => {
      await daemon.stop();
      await relay.stop();
      detach();
      await rm(dir, { recursive: true, force: true });
    },
  };
};
