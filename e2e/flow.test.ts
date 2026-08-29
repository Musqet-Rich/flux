import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { eventSeqs } from './event-seqs.ts';
import { stackTest as test } from './stack-test.ts';
import type { Stack } from './start-stack.ts';

// The one end-to-end flow (engineering.md § Testing): pair, start a session, watch the fake
// agent's turn land, comment on a line of its diff, send the comment with a message, check
// the agent was sent that message with the reference, then reload and check the timeline
// comes back whole. Every wait is Playwright's own; nothing sleeps.

const firstPrompt = 'Read notes.txt and write greeting.txt';
const secondPrompt = 'Change the greeting';
const connected = /^Connected to flux@/u;

// The lines the daemon wrote to the agent's stdin, one JSON message each.
const agentMessages = async (path: string): Promise<string[]> =>
  (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { message: { content: string } }).message.content);

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
  // Everything the agent said that is not a message or a tool call shows as a `raw event`.
  const tools = timeline.locator('.item.tool .summary').filter({ hasNotText: 'raw event' });
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

const reload = async (page: Page, stack: Stack): Promise<void> => {
  const items = page.locator('.timeline .item');
  const session = new URL(page.url()).pathname.slice('/s/'.length);
  const before = await items.allInnerTexts();
  await page.reload();
  await expect(items).toHaveText(before);
  await expect(page.locator('.status')).toHaveText(connected);
  expect(eventSeqs(stack.database, session)).toEqual(before.map((_, index) => index + 1));
};

test('pair, run an agent, comment on its diff, send, reload', async ({ page, stack }) => {
  await test.step('pair by pasting the link flux pair printed', () => pair(page, stack));
  await test.step('create a session on a new branch of the demo repo', () => createSession(page));
  await test.step('the reply and its tool calls arrive in the timeline', () => firstTurn(page));
  await test.step('comment on a line of the diff', () => commentOnDiff(page));
  await test.step('send it with a message; the agent gets the reference', () =>
    sendWithComment(page, stack));
  await test.step('after a reload the timeline is the event log, whole', () => reload(page, stack));
});
