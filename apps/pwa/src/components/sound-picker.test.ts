import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import SoundPicker from './SoundPicker.vue';

test('picking a sound applies and plays it at once; Play repeats it and is off for None', async () => {
  const played: string[] = [];
  const box = await pairedStore(
    [],
    {},
    {
      playSound: (name) => {
        played.push(name);
      },
    },
  );
  const wrapper = mount(SoundPicker, { props: { store: box.store } });
  const select = wrapper.find<HTMLSelectElement>('#flux-sound');
  expect(select.element.value).toBe('none');
  expect(wrapper.findAll('option').map((o) => o.text())).toEqual([
    'None',
    'Chime',
    'Ping',
    'Marimba',
    'Pulse',
  ]);
  const play = wrapper.find('button');
  expect(play.attributes('disabled')).toBeDefined();
  await select.setValue('marimba');
  await flushPromises();
  expect(box.store.state.sound).toBe('marimba');
  expect(played).toEqual(['marimba']);
  expect(play.attributes('disabled')).toBeUndefined();
  await play.trigger('click');
  expect(played).toEqual(['marimba', 'marimba']);
  await select.setValue('none');
  await flushPromises();
  expect(played).toEqual(['marimba', 'marimba']);
  expect(play.attributes('disabled')).toBeDefined();
  box.store.stop();
});
