import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { stackTest as test } from './stack-test.ts';
import type { Stack } from './start-stack.ts';

// The subagent capture (apps/daemon/test/fixtures/claude/session-subagents) played back by the
// fake agent: the agents strip lists the two Explore tasks the parent ran, a tapped row shows
// that subagent's own chat with a note in place of the composer, and Back returns to main.

test.use({
  capture: fileURLToPath(
    new URL('../apps/daemon/test/fixtures/claude/session-subagents.jsonl', import.meta.url),
  ),
});

const prompt = 'Launch two Explore subagents';

const pairAndStart = async (page: Page, stack: Stack): Promise<void> => {
  await page.goto(stack.pwaUrl);
  await page.getByLabel('Or paste the link').fill(stack.pairingUrl);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await page.locator('.empty').getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('Repository').selectOption({ label: 'demo' });
  await page.getByLabel('Branch').fill('e2e/subagents');
  await page.getByLabel('First message').fill(prompt);
  await page.getByRole('button', { name: 'Start agent' }).click();
  await expect(page.locator('.branch')).toHaveText('e2e/subagents');
};

const stripListsTasks = async (page: Page): Promise<void> => {
  const rows = page.getByRole('navigation', { name: 'Agents' }).getByRole('button');
  await expect(rows).toHaveText([
    /main$/u,
    /○\s*Explore\s*List directory files/u,
    /○\s*Explore\s*Read a.txt contents/u,
  ]);
  const timeline = page.locator('.timeline');
  await expect(timeline.locator('.item.assistant').last()).toHaveText('done');
  // Main keeps the task notes and the reports; nothing of the subagents' own rows.
  await expect(timeline.locator('.item.user')).toHaveText([prompt]);
  await expect(timeline.locator('.item.tool .summary')).toHaveText([
    'Agent: List directory files',
    'Agent: Read a.txt contents',
    'Agent ok',
    'Agent ok',
  ]);
  await expect(timeline.getByText('Task completed · 12.1k tokens')).toHaveCount(1);
};

const openSubagentChat = async (page: Page): Promise<void> => {
  const rows = page.getByRole('navigation', { name: 'Agents' }).getByRole('button');
  await rows.nth(1).click();
  const timeline = page.locator('.timeline');
  await expect(timeline.locator('.item.user')).toHaveText([/^List the files/u]);
  await expect(timeline.locator('.item.tool .summary')).toHaveText([/^Bash: ls/u, /^Bash ok/u]);
  await expect(page.locator('.aside .hint')).toHaveText('Task completed. Messages go to main');
  await expect(page.getByPlaceholder('Message the agent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByPlaceholder('Message the agent')).toBeVisible();
  await expect(timeline.locator('.item.assistant').last()).toHaveText('done');
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
};

test('subagents get their own chats, reached from the agents strip', async ({ page, stack }) => {
  await test.step('pair and start a session on the subagent capture', () =>
    pairAndStart(page, stack));
  await test.step('the strip lists both Explore tasks, done', () => stripListsTasks(page));
  await test.step('a tapped row opens that chat; Back returns to main', () =>
    openSubagentChat(page));
});
