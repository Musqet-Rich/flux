import type { SettingsPatch } from '@flux/protocol';

import { boxLink } from './box-link.ts';
import type { StoreInternals } from './store-state.ts';

// The settings screen's actions (prd.md P2): devices and box configuration. Each resolves to
// whether it worked and puts the failure in `state.error`, like the other view actions.

export interface SettingsActions {
  refreshDevices: () => Promise<boolean>;
  // Revokes a device; revoking this one lands on the pair screen.
  removeDevice: (deviceId: string) => Promise<boolean>;
  refreshSettings: () => Promise<boolean>;
  saveSettings: (patch: SettingsPatch) => Promise<boolean>;
}

const refreshDevices = async (i: StoreInternals): Promise<void> => {
  i.state.devices = await boxLink.call(i, 'devices.list', {});
};

const removeDevice = async (i: StoreInternals, deviceId: string): Promise<void> => {
  const self = i.state.devices.find((d) => d.deviceId === deviceId)?.current === true;
  await boxLink.call(i, 'devices.remove', { deviceId });
  // The box tells this device too, but the answer came first; do not wait for the notice.
  if (self) await boxLink.unpair(i, 'This device was removed from the box.');
  else i.state.devices = i.state.devices.filter((d) => d.deviceId !== deviceId);
};

const saveSettings = async (i: StoreInternals, patch: SettingsPatch): Promise<void> => {
  i.state.settings = await boxLink.call(i, 'settings.set', patch);
};

export const settingsActions = (i: StoreInternals): SettingsActions => ({
  refreshDevices: () => boxLink.attempt(i, () => refreshDevices(i)),
  removeDevice: (deviceId) => boxLink.attempt(i, () => removeDevice(i, deviceId)),
  refreshSettings: () =>
    boxLink.attempt(i, async () => {
      i.state.settings = await boxLink.call(i, 'settings.get', {});
    }),
  saveSettings: (patch) => boxLink.attempt(i, () => saveSettings(i, patch)),
});
