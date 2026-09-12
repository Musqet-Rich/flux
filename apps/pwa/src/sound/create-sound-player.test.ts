import { expect, test } from 'vitest';
import { reactive } from 'vue';

import { until } from '../../test/until.ts';
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainLike,
  OscillatorLike,
} from './create-sound-player.ts';
import { createSoundPlayer } from './create-sound-player.ts';
import { notificationSounds } from './notification-sounds.ts';

// A fake audio context that records what the player schedules, in place of the Web Audio API
// (absent under Node and happy-dom).

interface GainRecord {
  peak: number;
  toDestination: boolean;
}

interface Played {
  oscillator: OscillatorLike;
  frequency: number;
  start: number;
  stop: number;
  through: GainRecord | null;
}

// Every ramp reports its target value; the record keeps the highest, which is the peak.
const param = (onSet: (value: number, at: number) => void): AudioParamLike => ({
  setValueAtTime: onSet,
  linearRampToValueAtTime: onSet,
  exponentialRampToValueAtTime: onSet,
});

// `played` is reactive so a test can `until` the notes land rather than count microtasks.
const fakeContext = (state = 'running') => {
  const played = reactive<Played[]>([]);
  const gains = new Map<AudioNodeLike, GainRecord>();
  const destination: AudioNodeLike = { connect: () => null };
  let resumed = 0;
  const context: AudioContextLike = {
    currentTime: 10,
    state,
    destination,
    resume: () => {
      resumed += 1;
      context.state = 'running';
      return Promise.resolve();
    },
    createOscillator: () => {
      const oscillator: OscillatorLike = {
        type: 'sine',
        frequency: param((value) => {
          entry.frequency = value;
        }),
        connect: (to) => {
          entry.through = gains.get(to) ?? null;
        },
        start: (at) => {
          entry.start = at;
        },
        stop: (at) => {
          entry.stop = at;
        },
      };
      const entry: Played = { oscillator, frequency: 0, start: 0, stop: 0, through: null };
      played.push(entry);
      return oscillator;
    },
    createGain: () => {
      const record: GainRecord = { peak: 0, toDestination: false };
      const node: GainLike = {
        gain: param((value) => {
          record.peak = Math.max(record.peak, value);
        }),
        connect: (to) => {
          record.toDestination = to === destination;
        },
      };
      gains.set(node, record);
      return node;
    },
  };
  return { context, played, resumed: () => resumed };
};

test('playing a sound schedules each of its notes from now, through a gain into the output', async () => {
  const fake = fakeContext();
  const player = createSoundPlayer(() => fake.context);
  player.play('marimba');
  const notes = notificationSounds.catalogue.marimba.notes;
  await until(() => fake.played.length === notes.length);
  expect(fake.played.map((p) => p.oscillator.type)).toEqual(notes.map((n) => n.wave));
  expect(fake.played.map((p) => p.frequency)).toEqual(notes.map((n) => n.frequency));
  expect(fake.played.map((p) => p.start)).toEqual(notes.map((n) => 10 + n.at));
  expect(fake.played.map((p) => p.stop)).toEqual(notes.map((n) => 10 + n.at + n.duration + 0.05));
  expect(fake.played.map((p) => p.through?.peak)).toEqual(notes.map((n) => n.gain));
  expect(fake.played.every((p) => p.through?.toDestination === true)).toBe(true);
  expect(fake.resumed()).toBe(0);
});

test('none plays nothing and creates no context; a missing API is a no-op', () => {
  let created = 0;
  const player = createSoundPlayer(() => {
    created += 1;
    return fakeContext().context;
  });
  player.play('none');
  expect(created).toBe(0);
  const absent = createSoundPlayer(() => null);
  absent.play('chime');
  absent.prime();
});

test('a context not yet running is resumed on prime and on play, and created only once', async () => {
  const fake = fakeContext('suspended');
  let created = 0;
  const player = createSoundPlayer(() => {
    created += 1;
    return fake.context;
  });
  player.prime();
  expect(fake.resumed()).toBe(1);
  // Nothing was pending, so the prime alone plays nothing; a play on the now running context
  // needs no resume.
  player.play('ping');
  await until(() => fake.played.length === 1);
  expect(fake.resumed()).toBe(1);
  // iOS leaves a context `interrupted` after a call; that needs a resume too.
  fake.context.state = 'interrupted';
  player.play('ping');
  expect(fake.resumed()).toBe(2);
  await until(() => fake.played.length === 2);
  expect(created).toBe(1);
});

// A page reloaded with a sound chosen and not yet tapped has a context the browser will not
// start until a tap; the browser leaves each resume() pending until then. Rings while it waits
// must not queue up to burst out together at the first tap: one, the latest, plays.
test('rings while the context waits for a tap collapse into one at the tap', async () => {
  const fake = fakeContext('suspended');
  const starts: (() => void)[] = [];
  fake.context.resume = () =>
    new Promise((resolve) => {
      starts.push(() => {
        fake.context.state = 'running';
        resolve();
      });
    });
  const player = createSoundPlayer(() => fake.context);
  player.play('chime');
  player.play('ping');
  player.play('chime');
  expect(starts).toHaveLength(3);
  // The tap: prime asks too, and the browser then settles every resume.
  player.prime();
  expect(starts).toHaveLength(4);
  starts.splice(0).forEach((start) => {
    start();
  });
  await until(() => fake.played.length === notificationSounds.catalogue.chime.notes.length);
  expect(fake.played.map((p) => p.frequency)).toEqual(
    notificationSounds.catalogue.chime.notes.map((n) => n.frequency),
  );
  // The next play on the running context goes straight through.
  player.play('ping');
  await until(() => fake.played.length === notificationSounds.catalogue.chime.notes.length + 1);
});

test('a play the browser refuses is dropped, not kept for the next tap', async () => {
  const fake = fakeContext('suspended');
  fake.context.resume = () => Promise.reject(new Error('NotAllowedError'));
  const player = createSoundPlayer(() => fake.context);
  player.play('chime');
  player.play('chime');
  // The tap comes once the browser is willing: had the refused chime been kept, this prime
  // would play it; only the ping parked after it is heard.
  fake.context.resume = () => {
    fake.context.state = 'running';
    return Promise.resolve();
  };
  player.prime();
  player.play('ping');
  await until(() => fake.played.length > 0);
  expect(fake.played.map((p) => p.frequency)).toEqual([
    notificationSounds.catalogue.ping.notes[0]?.frequency,
  ]);
});
