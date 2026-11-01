import type { Bytes } from '@flux/protocol';
import { pairing } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { ref } from 'vue';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import PairDaemonDialog from './PairDaemonDialog.vue';

// "Pair another daemon" (ADR 0037): a refused pairing keeps the dialog open with the reason and
// the open daemon open; one that goes through closes it.

const linkFor = (boxPub: Bytes): string =>
  pairing.url('https://relay.example', {
    boxPub,
    secret: new Uint8Array(pairing.secretLength),
  });

test('a refused pairing says why, keeps the dialog and leaves the open daemon open', async () => {
  const box = await pairedStore();
  const wrapper = mount(PairDaemonDialog, { props: { store: box.store }, attachTo: document.body });
  box.relay.refuseCall('pair.request', 'bad_proof');
  await wrapper.find('input').setValue(linkFor(box.relay.boxPub));
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.error !== null);
  await flushPromises();
  expect(wrapper.find('.error').text()).toBe('pair.request refused');
  expect(wrapper.emitted('close')).toBeUndefined();
  expect(box.store.state.phase).toBe('paired');
  wrapper.unmount();
  box.store.stop();
});

test('a pairing that goes through closes the dialog', async () => {
  const box = await pairedStore();
  const closed = ref(false);
  const onClose = (): void => {
    closed.value = true;
  };
  const wrapper = mount(PairDaemonDialog, {
    props: { store: box.store, onClose },
    attachTo: document.body,
  });
  await wrapper.find('input').setValue(linkFor(box.relay.boxPub));
  await wrapper.find('form').trigger('submit');
  await until(() => closed.value);
  expect(box.store.state.phase).toBe('paired');
  wrapper.unmount();
  box.store.stop();
});
