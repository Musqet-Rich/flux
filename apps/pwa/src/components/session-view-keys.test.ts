import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import SessionView from './SessionView.vue';

// The session screen's keyboard: Esc is the Stop button from the keyboard, only while the agent
// runs, once per press, never for an IME's Escape, and not for one something open has already
// taken (a menu, the slash list, the help modal, the Rename…/Delete… forms, the image overlay).

const escapeKey = 'Escape';
const escape = (init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: escapeKey, bubbles: true, cancelable: true, ...init });

test('Esc interrupts the running agent unless the key was consumed or the agent is idle', async () => {
  const box = await pairedStore([], { 'agent.interrupt': () => ({}) });
  const { store, relay, event } = box;
  // In the document, so a key in the composer bubbles to the window as it does in a browser.
  const wrapper = mount(SessionView, { props: { store, session: 's1' }, attachTo: document.body });
  await until(() => store.state.logs['s1'] !== undefined);
  window.dispatchEvent(escape());
  await relay.emit(event(1, 'session.state', { state: 'running' }));
  await until(() => store.state.sessions[0]?.state === 'running');
  await flushPromises();
  const taken = escape();
  taken.preventDefault();
  window.dispatchEvent(taken);
  window.dispatchEvent(escape({ repeat: true }));
  window.dispatchEvent(escape({ isComposing: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  // The one that counts goes last: the fake box answers in order, so a stray call from any of
  // the presses above would have landed before it and show in the list once it has settled.
  wrapper.find('textarea').element.dispatchEvent(escape());
  await until(() => box.calls('agent.interrupt').length > 0);
  await flushPromises();
  expect(box.calls('agent.interrupt')).toEqual([{ session: 's1' }]);
  wrapper.unmount();
  window.dispatchEvent(escape());
  // The same trick: a call made by hand after the press would land after any the press made.
  void store.interrupt('s1');
  await until(() => box.calls('agent.interrupt').length === 2);
  await flushPromises();
  expect(box.calls('agent.interrupt')).toHaveLength(2);
  store.stop();
});

// ⌃⌥M puts the caret in the composer from anywhere on the screen, and the box's title says so.
test('the focus chord reaches the composer', async () => {
  const { store } = await pairedStore([]);
  const wrapper = mount(SessionView, { props: { store, session: 's1' }, attachTo: document.body });
  await until(() => store.state.logs['s1'] !== undefined);
  const box = wrapper.find('textarea').element;
  expect(box.title).toMatch(/^Message the agent \((⌃⌥M|Ctrl\+Alt\+M)\)$/u);
  const chord = new KeyboardEvent('keydown', {
    key: 'm',
    code: 'KeyM',
    ctrlKey: true,
    altKey: true,
    cancelable: true,
  });
  window.dispatchEvent(chord);
  expect(chord.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(box);
  box.blur();
  wrapper.unmount();
});
