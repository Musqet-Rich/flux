import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { createAskRegistry } from './create-ask-registry.ts';
import { createAttachmentStore } from './create-attachment-store.ts';
import { createControlHandler } from './create-control-handler.ts';
import { createEventLog } from './create-event-log.ts';
import { createSessionStore } from './create-session-store.ts';
import { openDatabase } from './open-database.ts';

// flux_file_send end to end on the box (ADR 0036): the control socket's `offer` through the real
// handler, attachment store, event log and SQLite, with real files in a temp dir. The supervisor
// and the manager ops are never reached on this path.

const day = 24 * 60 * 60 * 1000;

// `refuse` stands in for a log that will not take the row (a full disk, say).
const setup = async (refuse = false) => {
  const root = await mkdtemp(join(tmpdir(), 'flux-control-offer-'));
  const worktree = join(root, 'worktree');
  await mkdir(join(worktree, 'out'), { recursive: true });
  const dir = join(root, 'attachments');
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  sessions.create({
    session: 's1',
    title: 't',
    repo: '/r',
    worktree,
    branch: 'b',
    base: 'HEAD',
    harness: 'claude',
  });
  const clock = { at: new Date('2026-11-01T10:00:00Z') };
  const attachments = createAttachmentStore({ db, dir, now: () => clock.at });
  const emitted: string[] = [];
  const refusing = {
    ...log,
    append: () => {
      throw new Error('disk full');
    },
  };
  const handle = createControlHandler({
    log: refuse ? refusing : log,
    sessions,
    asks: createAskRegistry(),
    attachments,
    supervisor: () => {
      throw new Error('unused');
    },
    emit: (event) => {
      emitted.push(event.type);
    },
    pairingUrl: () => 'u',
    revokeDevice: () => Promise.resolve(),
    openSession: () => Promise.reject(new Error('unused')),
    archiveSession: () => Promise.resolve(),
    clearSession: () => Promise.reject(new Error('unused')),
    getAgents: () => [],
  });
  return { root, worktree, dir, log, attachments, clock, emitted, handle };
};

const offered = { id: expect.any(String), name: 'report.pdf', mime: 'application/pdf', size: 7 };

test('a relative path is the worktree’s: the file is copied in, offered and logged', async () => {
  const { worktree, dir, log, attachments, emitted, handle } = await setup();
  await writeFile(join(worktree, 'out', 'report.pdf'), 'figures');
  const result = await handle({
    type: 'offer',
    session: 's1',
    path: 'out/report.pdf',
    note: '  The quarterly figures ',
  });
  expect(result).toEqual({ attachment: { ...offered, image: false } });
  const [event] = log.read('s1', 0, 10).events;
  expect(event).toMatchObject({
    type: 'file.offered',
    payload: { attachment: { ...offered, image: false }, note: 'The quarterly figures' },
  });
  expect(emitted).toEqual(['file.offered']);
  // The copy is the one the device reads back, whatever happens to the source afterwards.
  await rm(join(worktree, 'out', 'report.pdf'));
  const id = (result as { attachment: { id: string } }).attachment.id;
  const slice = await attachments.read(id, 0, 1024);
  expect(Buffer.from(slice.data, 'base64').toString()).toBe('figures');
  expect(await readdir(join(dir, 's1'))).toEqual([`${id}-report.pdf`]);
});

test('an absolute path anywhere readable is fine; an image is marked so; a blank note is none', async () => {
  const { root, log, handle } = await setup();
  const source = join(root, 'elsewhere shot.png');
  await writeFile(source, 'png');
  const result = await handle({ type: 'offer', session: 's1', path: source, note: '   ' });
  expect(result).toMatchObject({
    attachment: { name: 'elsewhere_shot.png', mime: 'image/png', size: 3, image: true },
  });
  const [event] = log.read('s1', 0, 10).events;
  expect(event?.payload).not.toHaveProperty('note');
});

test('a refused offer logs nothing and leaves nothing on disk', async () => {
  const { worktree, dir, log, emitted, handle } = await setup();
  await expect(handle({ type: 'offer', session: 's1', path: 'missing.txt' })).rejects.toMatchObject(
    { code: 'not_found' },
  );
  await expect(handle({ type: 'offer', session: 's1', path: 'out' })).rejects.toMatchObject({
    code: 'bad_params',
  });
  await expect(handle({ type: 'offer', session: 'nope', path: worktree })).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(log.read('s1', 0, 10).events).toEqual([]);
  expect(emitted).toEqual([]);
  await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' });
});

// An offered file is never "an attachment nobody sent": the 24-hour sweep of unsent uploads
// leaves it, and it goes only with the session, like a sent one (ADR 0020 § 5).
test('the sweep keeps an offered file; deleting the session removes it', async () => {
  const { worktree, dir, attachments, clock, handle } = await setup();
  await writeFile(join(worktree, 'out', 'report.pdf'), 'figures');
  await handle({ type: 'offer', session: 's1', path: 'out/report.pdf' });
  const unsent = await attachments.begin('s1', 'draft.txt', 'text/plain', 1);
  await attachments.chunk(unsent, 0, Buffer.from('x').toString('base64'));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x'));
  await attachments.end(unsent, Buffer.from(digest).toString('hex'));
  clock.at = new Date(clock.at.getTime() + 2 * day);
  expect(await attachments.sweep()).toBe(1);
  expect(await readdir(join(dir, 's1'))).toHaveLength(1);
  await attachments.removeSession('s1');
  await expect(readdir(join(dir, 's1'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a log that refuses the row takes the copy back out', async () => {
  const { worktree, dir, emitted, handle } = await setup(true);
  await writeFile(join(worktree, 'out', 'report.pdf'), 'figures');
  await expect(handle({ type: 'offer', session: 's1', path: 'out/report.pdf' })).rejects.toThrow(
    'disk full',
  );
  expect(await readdir(join(dir, 's1'))).toEqual([]);
  expect(emitted).toEqual([]);
});

test('a leading ~/ is the home directory, as the agent’s shell reads it', async () => {
  const { handle } = await setup();
  const name = `flux-no-such-${crypto.randomUUID()}`;
  await expect(handle({ type: 'offer', session: 's1', path: `~/${name}` })).rejects.toThrow(
    `no file at ${join(homedir(), name)}`,
  );
});

// The stored name is capped (ADR 0020), but the cut comes out of the stem: a long name keeps its
// extension, and with it its type.
test('a long file name keeps its extension, and so its type', async () => {
  const { worktree, handle } = await setup();
  await writeFile(join(worktree, `${'a'.repeat(120)}.pdf`), 'figures');
  const result = await handle({ type: 'offer', session: 's1', path: `${'a'.repeat(120)}.pdf` });
  expect(result).toMatchObject({
    attachment: { name: `${'a'.repeat(96)}.pdf`, mime: 'application/pdf' },
  });
});
