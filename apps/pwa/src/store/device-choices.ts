import { notificationSound } from './notification-sound.ts';
import { sendKey } from './send-key.ts';
import type { StoreInternals } from './store-state.ts';
import { switchKey } from './switch-key.ts';

// What this device keeps for itself, apart from the box: its notification sound
// (notification-sound.ts), which Enter sends (send-key.ts) and which chord switches session
// tabs (switch-key.ts), for box-link.ts, which reads them once when a connection is adopted
// and hands the sound every live event. A module of its own only because oxlint's
// `import/max-dependencies` (pedantic) allows box-link ten modules and it already had them;
// the settings actions reach the three directly.

const load = async (i: StoreInternals): Promise<void> => {
  await Promise.all([notificationSound.load(i), sendKey.load(i), switchKey.load(i)]);
};

export const deviceChoices: {
  load: typeof load;
  sound: typeof notificationSound;
} = { load, sound: notificationSound };
