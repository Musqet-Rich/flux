import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import type { Dev } from '../test/daemon-device.ts';
import { daemonDevice } from '../test/daemon-device.ts';
import type { FakeRelay } from '../test/fake-relay.ts';
import { startFakeRelay } from '../test/fake-relay.ts';
import { frameRouter } from '../test/frame-router.ts';
import { tempRepo } from '../test/temp-repo.ts';
import type { Daemon } from './create-daemon.ts';
import { createDaemon } from './create-daemon.ts';

// The whole daemon against a fake relay and the fake agent, for attachments (ADR 0020): a file
// travels in chunks over the channel, is named on the message, can be read back and deleted,
// and goes with the session when it is archived. What the agent is sent for an image is
// checked at the supervisor level against the real capture.

const fake = join(import.meta.dirname, '../test/fake-claude.ts');
const fixture = join(import.meta.dirname, '../test/fixtures/claude/session-two-turns.jsonl');
const emptyHash = createHash('sha256').digest('hex');
let relay: FakeRelay;
let daemon: Daemon;

afterEach(async () => {
  await daemon.stop();
  await relay.close();
});

const { device, call, untilEvent, pair } = daemonDevice({
  daemon: () => daemon,
  relay: () => relay,
  frames: () => frameRouter(relay.nextFrame),
});

const pairedSession = async () => {
  process.env['FLUX_FAKE_FIXTURE'] = fixture;
  const { root, repos, repo } = await tempRepo();
  relay = await startFakeRelay();
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
  const d = await device();
  await pair(d);
  const created = (await call(d, 'sessions.create', {
    repo,
    branch: 'flux/attach',
    agent: 'claude',
  })) as { session: string };
  return { d, session: created.session, root };
};

// Two chunks, then end with the real hash; a repeated chunk on the way is refused.
const upload = async (d: Dev, session: string, data: Buffer): Promise<string> => {
  const { attachmentId } = (await call(d, 'attach.begin', {
    session,
    name: 'note (1).txt',
    mime: 'text/plain',
    size: data.length,
  })) as { attachmentId: string };
  const chunk = (index: number, slice: Buffer) =>
    call(d, 'attach.chunk', { attachmentId, index, data: slice.toString('base64') });
  await chunk(0, data.subarray(0, 10));
  await expect(chunk(0, Buffer.alloc(1))).rejects.toThrow('bad_params');
  await chunk(1, data.subarray(10));
  const hash = createHash('sha256').update(data).digest('hex');
  const ended = await call(d, 'attach.end', { attachmentId, hash });
  expect(ended).toEqual({
    path: join(daemonDataDir(), 'attachments', session, `${attachmentId}-note__1_.txt`),
    size: data.length,
  });
  return attachmentId;
};

let dataDir = '';
const daemonDataDir = (): string => dataDir;

test('upload in chunks, send with a message, read back, delete, archive', async () => {
  const { d, session, root } = await pairedSession();
  dataDir = join(root, 'data');
  const data = Buffer.from('a small file for the agent');
  const attachmentId = await upload(d, session, data);
  const path = join(dataDir, 'attachments', session, `${attachmentId}-note__1_.txt`);
  expect(await readFile(path)).toEqual(data);
  expect(await call(d, 'attach.read', { attachmentId, offset: 2, length: 5 })).toEqual({
    data: data.subarray(2, 7).toString('base64'),
    size: data.length,
    mime: 'text/plain',
    name: 'note__1_.txt',
  });
  await expect(
    call(d, 'attach.begin', { session, name: 'x', mime: 'x', size: 21 * 1024 * 1024 }),
  ).rejects.toThrow('too_large');
  await expect(
    call(d, 'attach.begin', { session: 'nope', name: 'x', mime: 'x', size: 1 }),
  ).rejects.toThrow('not_found');
  await expect(
    call(d, 'agent.send', { session, text: 'read it', attachments: ['nope'] }),
  ).rejects.toThrow('not_found');
  const sent = (await call(d, 'agent.send', {
    session,
    text: 'read it',
    attachments: [attachmentId],
  })) as { seq: number };
  await untilEvent(d, 'turn.ended');
  const { events } = (await call(d, 'events.sync', { session, since: 0 })) as {
    events: { seq: number; payload: unknown }[];
  };
  expect(events.find((e) => e.seq === sent.seq)?.payload).toEqual({
    text: 'read it',
    attachments: [
      {
        id: attachmentId,
        name: 'note__1_.txt',
        mime: 'text/plain',
        size: data.length,
        image: false,
      },
    ],
  });
  await call(d, 'sessions.archive', { session });
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an attachment the operator removes before sending is deleted', async () => {
  const { d, session } = await pairedSession();
  const { attachmentId } = (await call(d, 'attach.begin', {
    session,
    name: 'gone.txt',
    mime: 'text/plain',
    size: 0,
  })) as { attachmentId: string };
  await call(d, 'attach.end', { attachmentId, hash: emptyHash });
  await call(d, 'attach.delete', { attachmentId });
  await expect(call(d, 'attach.read', { attachmentId, offset: 0, length: 1 })).rejects.toThrow(
    'not_found',
  );
  await expect(call(d, 'attach.delete', { attachmentId })).rejects.toThrow('not_found');
});
