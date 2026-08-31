import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import type { PairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import CommandRunner from './CommandRunner.vue';

// The runner view (ADR 0026): a command is sent through `shellRun`, its streamed output renders in
// arrival order with ANSI colour as spans, the exit line shows and re-enables the input, Stop calls
// `shellInterrupt`, and Copy puts the run's output on the clipboard.

const E = '\u001B';

const clipboard = (): { writeText: ReturnType<typeof vi.fn> } => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return { writeText };
};

const setup = async (): Promise<PairedStore & { wrapper: VueWrapper }> => {
  const box = await pairedStore([], {
    'shell.run': () => ({ runId: 'r1' }),
    'shell.interrupt': () => ({}),
  });
  const wrapper = mount(CommandRunner, { props: { store: box.store } });
  return { ...box, wrapper };
};

const disabled = (wrapper: VueWrapper): boolean =>
  (wrapper.find('input').element as HTMLInputElement).disabled;

// The output has at least one span carrying a colour style (the `??` stays out of the test body).
const hasColour = (wrapper: VueWrapper): boolean =>
  wrapper.findAll('.output span').some((s) => (s.attributes('style') ?? '').includes('color'));

const send = async (box: PairedStore, wrapper: VueWrapper, text: string): Promise<void> => {
  await wrapper.find('input').setValue(text);
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.runner.runs.length === 1);
};

test('sending a command calls shellRun and shows the command', async () => {
  const box = await setup();
  await send(box, box.wrapper, 'echo hi');
  expect(box.calls('shell.run')).toEqual([{ command: 'echo hi' }]);
  expect(box.wrapper.text()).toContain('echo hi');
  box.store.stop();
});

test('streamed output renders in order with ANSI colour, and the input is disabled while running', async () => {
  const box = await setup();
  await send(box, box.wrapper, 'go');
  expect(disabled(box.wrapper)).toBe(true);
  await box.relay.ephemeral({
    type: 'shell.output',
    runId: 'r1',
    stream: 'stdout',
    chunk: `${E}[32mone${E}[0m\n`,
  });
  await box.relay.ephemeral({
    type: 'shell.output',
    runId: 'r1',
    stream: 'stderr',
    chunk: 'two\n',
  });
  await until(() => box.store.state.runner.runs[0]?.output.includes('two') === true);
  await box.wrapper.vm.$nextTick();
  expect(box.store.state.runner.runs[0]?.output).toBe(`${E}[32mone${E}[0m\ntwo\n`);
  expect(hasColour(box.wrapper)).toBe(true);
  expect(box.wrapper.text()).toContain('one');
  expect(box.wrapper.text()).toContain('two');
  box.store.stop();
});

test('shell.exited shows the exit line and re-enables the input', async () => {
  const box = await setup();
  await send(box, box.wrapper, 'go');
  await box.relay.ephemeral({
    type: 'shell.exited',
    runId: 'r1',
    code: 0,
    signal: null,
    truncated: false,
  });
  await until(() => box.store.state.runner.activeRunId === null);
  await box.wrapper.vm.$nextTick();
  expect(box.wrapper.text()).toContain('exit 0');
  expect(disabled(box.wrapper)).toBe(false);
  box.store.stop();
});

test('a killed, truncated run reports the signal and the truncation', async () => {
  const box = await setup();
  await send(box, box.wrapper, 'go');
  await box.relay.ephemeral({
    type: 'shell.exited',
    runId: 'r1',
    code: null,
    signal: 'SIGKILL',
    truncated: true,
  });
  await until(() => box.store.state.runner.runs[0]?.exit !== null);
  await box.wrapper.vm.$nextTick();
  expect(box.wrapper.text()).toContain('killed (SIGKILL)');
  expect(box.wrapper.text()).toContain('output truncated');
  box.store.stop();
});

test('Stop calls shellInterrupt for the active run', async () => {
  const box = await setup();
  await send(box, box.wrapper, 'go');
  await box.wrapper.find('.stop').trigger('click');
  await until(() => box.calls('shell.interrupt').length === 1);
  expect(box.calls('shell.interrupt')).toEqual([{ runId: 'r1' }]);
  box.store.stop();
});

test('Copy puts the run output on the clipboard', async () => {
  const { writeText } = clipboard();
  const box = await setup();
  await send(box, box.wrapper, 'go');
  await box.relay.ephemeral({
    type: 'shell.output',
    runId: 'r1',
    stream: 'stdout',
    chunk: 'result',
  });
  await until(() => box.store.state.runner.runs[0]?.output === 'result');
  await box.wrapper.vm.$nextTick();
  await box.wrapper.find('.copy').trigger('click');
  await until(() => writeText.mock.calls.length === 1);
  expect(writeText).toHaveBeenCalledWith('result');
  box.store.stop();
});
