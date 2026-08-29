import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { daemonDevice } from '../test/daemon-device.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import type { FrameRouter } from '../test/frame-router.ts';
import { frameRouter } from '../test/frame-router.ts';
import { tempRepo } from '../test/temp-repo.ts';
import type { Daemon } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';
import { createEventLog } from './create-event-log.ts';
import { openDatabase } from './open-database.ts';

// The daemon's lifecycle (ADR 0017) at the wire: what stop() does to an ask in flight, and what
// a start on the same data dir finds.

const fake = join(import.meta.dirname, '../test/fake-claude.ts');
let relay: FakeRelay;
let frames: FrameRouter;
let daemon: Daemon;

afterEach(async () => {
  await daemon.stop();
  await relay.close();
});

const setup = async () => {
  const { root, repos, repo } = await tempRepo();
  relay = await startFakeRelay();
  frames = frameRouter(relay.nextFrame);
  daemon = await createDaemon({
    dataDir: join(root, 'data'),
    relayUrl: relay.url,
    reposDir: repos,
    daemonName: 'flux@test',
    pushSubject: 'mailto:ops@example.com',
    claudeCommand: fake,
    piCommand: 'no-such-binary-anywhere',
    claudeDir: join(root, 'claude'),
  });
  await daemon.start();
  await relay.host();
  return { repo, dataDir: join(root, 'data') };
};

const { device, call, untilEvent, pair } = daemonDevice({
  daemon: () => daemon,
  relay: () => relay,
  frames: () => frames,
});

// What flux-mcp does for flux_ask: one line to the control socket, then it waits for the reply.
const controlAsk = (session: string) => {
  const client = connect(daemon.controlSocket, () => {
    client.write(`${JSON.stringify({ type: 'ask', session, question: 'go on?' })}\n`);
  });
  const reply = new Promise<unknown>((resolve) => {
    client.once('data', (chunk: Buffer) => {
      resolve(JSON.parse(chunk.toString()));
    });
  });
  return { reply, end: () => client.end() };
};

test('stop answers an ask in flight as aborted on its connection and in the log', async () => {
  const { repo, dataDir } = await setup();
  const d = await device();
  await pair(d);
  await call(d, 'hello', { protocol: 1 });
  const created = (await call(d, 'sessions.create', { repo, branch: 'b', agent: 'claude' })) as {
    session: string;
  };
  const asked = controlAsk(created.session);
  await untilEvent(d, 'ask');
  await daemon.stop();
  expect(await asked.reply).toEqual({ ok: true, result: { answer: '', by: 'aborted' } });
  asked.end();
  const log = createEventLog({ db: openDatabase(join(dataDir, 'flux.sqlite')) });
  const tail = log.read(created.session, 0).events.slice(-4);
  expect(tail.map((e) => [e.type, e.payload])).toEqual([
    ['session.state', { state: 'waiting_user' }],
    ['session.state', { state: 'running' }],
    ['ask.answered', { askId: expect.any(String), answer: '', by: 'aborted' }],
    ['session.state', { state: 'idle', reason: 'agent closed' }],
  ]);
});

// sessions.clear mid-ask (ADR 0018): the ask is answered on its connection and in the log
// before the marker, once; the connection drop that follows adds nothing after it.
test('clear answers an ask in flight as aborted, logged before the marker', async () => {
  const { repo, dataDir } = await setup();
  const d = await device();
  await pair(d);
  await call(d, 'hello', { protocol: 1 });
  const created = (await call(d, 'sessions.create', { repo, branch: 'b', agent: 'claude' })) as {
    session: string;
  };
  const asked = controlAsk(created.session);
  await untilEvent(d, 'ask');
  await call(d, 'sessions.clear', { session: created.session });
  expect(await asked.reply).toEqual({ ok: true, result: { answer: '', by: 'aborted' } });
  asked.end();
  await daemon.stop();
  const log = createEventLog({ db: openDatabase(join(dataDir, 'flux.sqlite')) });
  const tail = log.read(created.session, 0).events.slice(-4);
  expect(tail.map((e) => [e.type, e.payload])).toEqual([
    ['session.state', { state: 'waiting_user' }],
    ['ask.answered', { askId: expect.any(String), answer: '', by: 'aborted' }],
    ['session.state', { state: 'idle', reason: 'agent closed' }],
    ['session.cleared', {}],
  ]);
});

// A shutdown that cannot wait for stop(): the lock goes at once, so the next daemon on this
// directory starts instead of refusing. (What it does to agents: create-session-supervisor.test.)
test('abandon releases the lock synchronously, so a new daemon can start', async () => {
  const { dataDir } = await setup();
  const config = {
    dataDir,
    relayUrl: relay.url,
    reposDir: dataDir,
    daemonName: 'flux@next',
    pushSubject: 'mailto:ops@example.com',
    claudeDir: dataDir,
  };
  const refused = await createDaemon(config);
  await expect(refused.start()).rejects.toThrow('another flux daemon');
  daemon.abandon();
  const next = await createDaemon(config);
  await next.start();
  await next.stop();
  await daemon.stop();
});
