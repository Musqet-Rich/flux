import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { eventRows } from './event-rows.ts';
import { stackTest as test } from './stack-test.ts';
import type { Stack } from './start-stack.ts';

// The one end-to-end flow (engineering.md § Testing): pair, open a second tab of the same
// profile, start a session, watch the fake agent's turn land in both tabs, close the second,
// comment on a line of its diff, send the comment with a message, check the agent was sent
// that message with the reference, attach an image and check the agent was sent it as a
// block, then reload and check the timeline comes back whole. Every wait is Playwright's own;
// nothing sleeps.

const firstPrompt = 'Read notes.txt and write greeting.txt';
const secondPrompt = 'Change the greeting';
const thirdPrompt = 'What colour is this?';
const connected = /^Connected to flux@/u;
const png = fileURLToPath(new URL('./red.png', import.meta.url));

// A stream-json user message's content: a string, or blocks once an image rides along.
type Block = { type: 'text'; text: string } | { type: 'image'; source: { data: string } };
type Content = string | Block[];

// The lines the daemon wrote to the agent's stdin, one JSON message each. The file exists
// from the first prompt on, so a missing one is a failure, not something to wait out.
const agentContents = async (path: string): Promise<Content[]> =>
  (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { message: { content: Content } }).message.content);

const textOf = (content: Content): string =>
  typeof content === 'string'
    ? content
    : content.map((block) => (block.type === 'text' ? block.text : '')).join('');

const agentMessages = async (path: string): Promise<string[]> =>
  (await agentContents(path)).map((content) => textOf(content));

const pair = async (page: Page, stack: Stack): Promise<void> => {
  await page.goto(stack.pwaUrl);
  await page.getByLabel('Or paste the link').fill(stack.pairingUrl);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByText('No sessions yet.')).toBeVisible();
  await expect(page.locator('.status')).toHaveText(connected);
  // The built app registers its service worker; the dev server never does.
  await expect
    .poll(() =>
      page
        .context()
        .serviceWorkers()
        .map((worker) => worker.url()),
    )
    .toEqual([`${stack.pwaUrl}/sw.js`]);
};

// A second tab of the same browser profile is the same device on its own connection
// (protocol.md § 3, Handshake): it handshakes with the stored key, and neither tab is
// disturbed by the other's frames.
const openSecondTab = async (page: Page, stack: Stack): Promise<Page> => {
  const other = await page.context().newPage();
  await other.goto(stack.pwaUrl);
  await expect(other.getByText(connected)).toBeVisible();
  await expect(page.getByText(connected)).toBeVisible();
  return other;
};

const createSession = async (page: Page): Promise<void> => {
  await page.locator('.empty').getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('Repository').selectOption({ label: 'demo' });
  await page.getByLabel('Branch').fill('e2e/greeting');
  await page.getByLabel('First message').fill(firstPrompt);
  await page.getByRole('button', { name: 'Start agent' }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/u);
  await expect(page.locator('.branch')).toHaveText('e2e/greeting');
};

const firstTurn = async (page: Page): Promise<void> => {
  const timeline = page.locator('.timeline');
  await expect(timeline.locator('.item.user')).toHaveText(firstPrompt);
  await expect(timeline.locator('.item.assistant').first()).toHaveText(
    'Reading notes.txt, then writing greeting.txt.',
  );
  // Lines the adapter does not read are logged as `raw` and never rendered, so the tool rows
  // are the only `.tool` items.
  const tools = timeline.locator('.item.tool .summary');
  await expect(tools).toHaveText([
    'Bash: cat notes.txt',
    'Bash ok, 1 line',
    /^Write /u,
    'Write ok',
  ]);
  await tools.first().click();
  await expect(timeline.locator('.item.tool .detail')).toContainText('"command": "cat notes.txt"');
  await expect(timeline.locator('.item.assistant').last()).toHaveText(
    'notes.txt contains "hello", and greeting.txt has been created with "hi there".',
  );
  await expect(timeline.getByText('Agent idle')).toBeVisible();
};

// The second tab, which never spoke after its hello, got the turn too; closing it leaves
// the first tab to carry the rest of the flow on its own.
const secondTabSawTurn = async (other: Page): Promise<void> => {
  await other
    .getByRole('navigation', { name: 'Sessions' })
    .getByRole('button', { name: 'e2e/greeting' })
    .click();
  await expect(other.locator('.timeline .item.assistant').last()).toHaveText(
    'notes.txt contains "hello", and greeting.txt has been created with "hi there".',
  );
  await expect(other.getByText(connected)).toBeVisible();
  await other.close();
};

const commentOnDiff = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Changes' }).click();
  await expect(page.locator('.count')).toHaveText('1 changed');
  await page.getByRole('button', { name: 'greeting.txt' }).click();
  await expect(page.locator('.path')).toHaveText('greeting.txt');
  await page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: '1' }).click();
  await page.getByLabel('Comment on line 1').fill('Say hello instead');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('.comment .where')).toHaveText('greeting.txt:1');
  await expect(page.locator('.comment .text')).toHaveText('Say hello instead');
};

const sendWithComment = async (page: Page, stack: Stack): Promise<void> => {
  const timeline = page.locator('.timeline');
  await page.getByRole('button', { name: '‹ Changes' }).click();
  await page.getByRole('button', { name: '‹ Session' }).click();
  await expect(page.locator('.comment .where')).toHaveText('greeting.txt:1');
  await page.getByPlaceholder('Message the agent').fill(secondPrompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.comment')).toHaveCount(0);
  await expect(timeline.getByText('1 comment(s) sent')).toBeVisible();
  await expect(timeline.locator('.item.assistant').last()).toHaveText(
    'greeting.txt now says "hi again".',
  );
  await expect
    .poll(() => agentMessages(stack.agentStdin))
    .toEqual([firstPrompt, `${secondPrompt}\n\n\`\`\`greeting.txt:1-1\nhi there\n\`\`\``]);
};

// A PNG picked through the + button's file input shows as a chip with a thumbnail, uploads,
// and goes with the message: the bubble shows the thumbnail (fetched back from the box), and
// the agent's stdin carries the image as a base64 block beside the text (ADR 0020).
const attachImage = async (page: Page, stack: Stack): Promise<void> => {
  const timeline = page.locator('.timeline');
  await page.locator('.composer input[type="file"]').setInputFiles(png);
  await expect(page.locator('.chip .name')).toHaveText('red.png');
  await expect(page.locator('.chip img')).toBeVisible();
  await page.getByPlaceholder('Message the agent').fill(thirdPrompt);
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chip')).toHaveCount(0);
  const bubble = timeline.locator('.item.user').last();
  await expect(bubble.locator('.markdown')).toHaveText(thirdPrompt);
  await expect(bubble.locator('.files img')).toBeVisible();
  await expect(bubble.locator('.files img')).toHaveAttribute('src', /^blob:/u);
  // The fake cycles through the fixture's two turns, so the third message gets the first reply.
  await expect(timeline.locator('.item.assistant').last()).toHaveText(
    'notes.txt contains "hello", and greeting.txt has been created with "hi there".',
  );
  const data = (await readFile(png)).toString('base64');
  await expect
    .poll(async () => (await agentContents(stack.agentStdin)).at(-1))
    .toEqual([
      {
        type: 'text',
        text: expect.stringMatching(
          /^What colour is this\?\n\nAttached: .*red\.png \(image\/png, 75 B\)$/u,
        ),
      },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
    ]);
};

// Every IndexedDB database the page has, deleted; the page's own connection closes on the
// reload that follows, which is when a blocked deletion goes through. A string, not a
// function: the harness is a Node program and has no DOM types to write this against.
const wipeStorage = `indexedDB.databases().then((dbs) => Promise.all(dbs.map((db) =>
  new Promise((done) => {
    const req = indexedDB.deleteDatabase(db.name);
    req.onsuccess = req.onerror = req.onblocked = () => done(null);
  }))))`;

// The timeline leaves these in the log unrendered (architecture.md, `SessionView`).
const hidden = new Set(['raw', 'rate_limit']);

// A wiped device: nothing cached, not even the pairing, so after the reload the timeline can
// only come from events.sync, from seq 0, and must match what the log holds: one row per
// event of a rendered type, once each, with the hidden types still in the log, gap-free.
const reloadCold = async (page: Page, stack: Stack): Promise<void> => {
  const items = page.locator('.timeline .item');
  const session = new URL(page.url()).pathname.slice('/s/'.length);
  const before = await items.allInnerTexts();
  await page.evaluate(wipeStorage);
  await page.reload();
  await page.getByLabel('Or paste the link').fill(await stack.pair());
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.locator('.status')).toHaveText(connected);
  await page
    .getByRole('navigation', { name: 'Sessions' })
    .getByRole('button', { name: 'e2e/greeting' })
    .click();
  await expect(items).toHaveText(before);
  const rows = eventRows(stack.database, session);
  expect(rows.map((row) => row.seq)).toEqual(rows.map((_, index) => index + 1));
  expect(rows.filter((row) => !hidden.has(row.type))).toHaveLength(before.length);
  expect(rows.filter((row) => hidden.has(row.type)).map((row) => row.type)).toEqual(
    expect.arrayContaining(['raw', 'rate_limit']),
  );
};

// Archiving takes the session off the strip and into the Archived section of the list screen;
// reopening brings it back with its timeline whole. Archiving deleted the session's
// attachments (ADR 0020), so the image row now shows the file's name and size in its place.
const archiveAndReopen = async (page: Page): Promise<void> => {
  const items = page.locator('.timeline .item');
  const before = (await items.allInnerTexts()).map((text) =>
    text === thirdPrompt ? `${thirdPrompt}📄red.png75 B` : text,
  );
  await page.getByRole('button', { name: 'Session menu' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('No sessions yet.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sessions' }).getByRole('button')).toHaveText([
    '+',
  ]);
  await page.getByText('Archived (1)').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/u);
  await expect(page.locator('.branch')).toHaveText('e2e/greeting');
  await expect(items).toHaveText(before);
};

test('pair, run an agent, comment on its diff, send, reload', async ({ page, stack }) => {
  await test.step('pair by pasting the link flux pair printed', () => pair(page, stack));
  const other = await test.step('a second tab connects as the same device', () =>
    openSecondTab(page, stack));
  await test.step('create a session on a new branch of the demo repo', () => createSession(page));
  await test.step('the reply and its tool calls arrive in the timeline', () => firstTurn(page));
  await test.step('the second tab saw the turn too, then closes', () => secondTabSawTurn(other));
  await test.step('comment on a line of the diff', () => commentOnDiff(page));
  await test.step('send it with a message; the agent gets the reference', () =>
    sendWithComment(page, stack));
  await test.step('attach an image; the agent gets it as a block', () => attachImage(page, stack));
  await test.step('wiped and reloaded, the timeline is the event log, whole', () =>
    reloadCold(page, stack));
  await test.step('archived into the list, reopened with its timeline', () =>
    archiveAndReopen(page));
});
