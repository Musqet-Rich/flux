import type { AudibleSoundName, Note, SoundName } from './notification-sounds.ts';
import { notificationSounds } from './notification-sounds.ts';

// Plays a notification sound through the Web Audio API. The slice of `AudioContext` used is
// described structurally so tests can hand in a fake and check what was scheduled, and so the
// browser's context is only created when it is first needed: creating one at load time is what
// browsers penalise under their autoplay rules.
//
// Autoplay: a context created outside a user gesture starts `suspended`, and `resume()` only
// takes effect from inside one; outside one the browser leaves the promise pending until a
// gesture starts the context (Chromium, WebKit), or rejects it. `prime` is the gesture: the app
// calls it on the first tap anywhere (app-store.ts), which unlocks the context for every later,
// gesture-less play. A play on a context that is not running is parked, one at a time, until
// the context runs: the latest ring replaces the one before it, so the first tap after a quiet
// spell plays one sound, not every missed one, and nothing is ever queued on a stopped clock.
// iOS also reports `interrupted` after a call or the lock screen, so anything but `running`
// is treated as needing a resume.

export interface AudioParamLike {
  setValueAtTime: (value: number, at: number) => unknown;
  linearRampToValueAtTime: (value: number, at: number) => unknown;
  exponentialRampToValueAtTime: (value: number, at: number) => unknown;
}

// `connect` is a method signature rather than a property so the browser's `AudioNode`, whose
// `connect` takes an `AudioNode`, still satisfies it (methods are compared bivariantly).
export interface AudioNodeLike {
  connect(to: AudioNodeLike): unknown;
}

export interface OscillatorLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start: (at: number) => void;
  stop: (at: number) => void;
}

export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: AudioNodeLike;
  resume: () => Promise<void>;
  createOscillator: () => OscillatorLike;
  createGain: () => GainLike;
}

export interface SoundPlayer {
  play: (name: SoundName) => void;
  // Creates and resumes the context; call from a user gesture.
  prime: () => void;
}

// The attack is a short linear ramp from near-silence (an exponential ramp cannot start at 0),
// the decay an exponential ramp back down, which is what makes a plain oscillator sound like a
// struck note rather than a buzzer.
const silent = 0.0001;
const attackS = 0.01;

const schedule = (context: AudioContextLike, note: Note, start: number): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const at = start + note.at;
  const end = at + note.duration;
  oscillator.type = note.wave;
  oscillator.frequency.setValueAtTime(note.frequency, at);
  gain.gain.setValueAtTime(silent, at);
  gain.gain.linearRampToValueAtTime(note.gain, at + attackS);
  gain.gain.exponentialRampToValueAtTime(silent, end);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(at);
  oscillator.stop(end + 0.05);
};

const browserContext = (): AudioContextLike | null =>
  'AudioContext' in globalThis ? new AudioContext() : null;

const play = (context: AudioContextLike, name: AudibleSoundName): void => {
  const start = context.currentTime;
  for (const note of notificationSounds.catalogue[name].notes) schedule(context, note, start);
};

export const createSoundPlayer = (
  create: () => AudioContextLike | null = browserContext,
): SoundPlayer => {
  let context: AudioContextLike | null = null;
  // The one sound waiting for the context to run.
  let pending: AudibleSoundName | null = null;
  const get = (): AudioContextLike | null => {
    context ??= create();
    return context;
  };
  // Every parked play and every prime asks for a resume: each resolves when the context starts
  // and the first to do so plays what is pending, the rest find nothing. A refusal (a browser
  // that rejects outside a gesture) drops the pending sound rather than keep it for the next
  // tap, which by then would be stale.
  const resumeThenPlay = async (ctx: AudioContextLike): Promise<void> => {
    try {
      await ctx.resume();
    } catch {
      pending = null;
      return;
    }
    const name = pending;
    pending = null;
    if (name !== null) play(ctx, name);
  };
  return {
    play: (name) => {
      if (name === 'none') return;
      const ctx = get();
      if (ctx === null) return;
      if (ctx.state === 'running') {
        play(ctx, name);
        return;
      }
      pending = name;
      void resumeThenPlay(ctx);
    },
    prime: () => {
      const ctx = get();
      if (ctx !== null && ctx.state !== 'running') void resumeThenPlay(ctx);
    },
  };
};
