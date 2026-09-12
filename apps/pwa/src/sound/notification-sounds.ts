// The notification sounds on offer (architecture.md § Notifications), described as notes rather
// than shipped as audio files: a few tones synthesised by the Web Audio API weigh nothing, need
// no licence and no dependency, and sound the same in every browser. `none` is the default: a
// browser refuses to play anything before the operator has tapped the page, so a sound only
// makes sense once they have chosen one in Settings.

const names = ['none', 'chime', 'ping', 'marimba', 'pulse'] as const;

export type SoundName = (typeof names)[number];
export type AudibleSoundName = Exclude<SoundName, 'none'>;

// One oscillator: `at` and `duration` in seconds from the start of the sound, `frequency` in Hz,
// `gain` the peak level (0..1) before the exponential decay to silence.
export interface Note {
  at: number;
  duration: number;
  frequency: number;
  wave: 'sine' | 'triangle' | 'square';
  gain: number;
}

export interface Sound {
  label: string;
  notes: Note[];
}

const isName = (v: unknown): v is SoundName => names.some((name) => name === v);

const isAudible = (name: SoundName): name is AudibleSoundName => name !== 'none';

// Levels are low on purpose: a phone on a desk should be heard, not startle. The square wave
// carries far more energy than a sine at the same gain, so `pulse` is quieter.
const catalogue: Record<AudibleSoundName, Sound> = {
  chime: {
    label: 'Chime',
    notes: [
      { at: 0, duration: 0.35, frequency: 880, wave: 'sine', gain: 0.25 },
      { at: 0.18, duration: 0.55, frequency: 1318.5, wave: 'sine', gain: 0.25 },
    ],
  },
  ping: {
    label: 'Ping',
    notes: [{ at: 0, duration: 0.45, frequency: 1760, wave: 'triangle', gain: 0.3 }],
  },
  marimba: {
    label: 'Marimba',
    notes: [
      { at: 0, duration: 0.15, frequency: 523.25, wave: 'sine', gain: 0.3 },
      { at: 0.12, duration: 0.15, frequency: 659.25, wave: 'sine', gain: 0.3 },
      { at: 0.24, duration: 0.35, frequency: 783.99, wave: 'sine', gain: 0.3 },
    ],
  },
  pulse: {
    label: 'Pulse',
    notes: [
      { at: 0, duration: 0.08, frequency: 660, wave: 'square', gain: 0.1 },
      { at: 0.16, duration: 0.08, frequency: 660, wave: 'square', gain: 0.1 },
    ],
  },
};

// The picker's rows, in catalogue order with `none` first.
const options: { name: SoundName; label: string }[] = names.map((name) => ({
  name,
  label: isAudible(name) ? catalogue[name].label : 'None',
}));

export const notificationSounds: {
  names: typeof names;
  isName: typeof isName;
  catalogue: typeof catalogue;
  options: typeof options;
} = { names, isName, catalogue, options };
