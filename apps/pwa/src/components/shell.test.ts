import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import type { RouterHistory } from '../router/create-router.ts';
import { createRouter } from '../router/create-router.ts';
import HelpModal from './HelpModal.vue';
import Shell from './Shell.vue';

// Shell owns the ⓘ "Ask about Flux" entry point: it opens the help modal and, on a created help
// session, navigates to it and closes the modal. The routed screens are stubbed so the test stays
// on the shell's own wiring.

const memoryHistory = (): RouterHistory => {
  let path = '/';
  return {
    location: () => ({ pathname: path, search: '' }),
    push: (p) => {
      path = p;
    },
    replace: (p) => {
      path = p;
    },
    listen: () => {},
  };
};

const stubs = {
  SessionTabs: true,
  SessionScreens: true,
  SettingsView: true,
  NewSessionView: true,
  ArchivedSessions: true,
  StatusBar: true,
  CommandRunner: true,
};

const helpSummary = {
  session: 'help-1',
  title: 'q',
  repo: '/data/help',
  branch: 'help-abc123',
  harness: 'claude' as const,
  state: 'idle' as const,
  lastSeq: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

test('renders the ⓘ button before the gear and opens the help modal on click', async () => {
  const box = await pairedStore([]);
  const router = createRouter(memoryHistory());
  const wrapper = mount(Shell, { props: { store: box.store, router }, global: { stubs } });
  const info = wrapper.get('button[aria-label="Ask about Flux"]');
  expect(info.text()).toBe('ⓘ');
  expect(info.attributes('title')).toBe('Ask about Flux');
  expect(wrapper.findComponent(HelpModal).exists()).toBe(false);
  await info.trigger('click');
  expect(wrapper.findComponent(HelpModal).exists()).toBe(true);
  box.store.stop();
});

test('the command-runner button opens the runner view (ADR 0026)', async () => {
  const box = await pairedStore([]);
  const router = createRouter(memoryHistory());
  const wrapper = mount(Shell, { props: { store: box.store, router }, global: { stubs } });
  const button = wrapper.get('button[aria-label="Command runner"]');
  expect(button.attributes('title')).toBe('Run a command');
  expect(wrapper.find('command-runner-stub').exists()).toBe(false);
  await button.trigger('click');
  expect(router.current.route).toMatchObject({ name: 'runner' });
  expect(wrapper.find('command-runner-stub').exists()).toBe(true);
  box.store.stop();
});

test('navigates to a created help session and closes the modal', async () => {
  const box = await pairedStore([]);
  const router = createRouter(memoryHistory());
  const wrapper = mount(Shell, { props: { store: box.store, router }, global: { stubs } });
  await wrapper.get('button[aria-label="Ask about Flux"]').trigger('click');
  wrapper.findComponent(HelpModal).vm.$emit('created', helpSummary);
  await flushPromises();
  expect(router.current.route).toMatchObject({ name: 'session', session: 'help-1' });
  expect(wrapper.findComponent(HelpModal).exists()).toBe(false);
  box.store.stop();
});
