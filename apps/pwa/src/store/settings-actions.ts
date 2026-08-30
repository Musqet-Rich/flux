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
  // Asks the daemon to discover the latest release and dry-run verify it (ADR 0021/0022). It
  // never surfaces an error: a daemon too old to have the method degrades to a `latest: null`
  // sentinel so Settings shows "couldn't check for updates" instead of hard-failing.
  checkUpdate: () => Promise<void>;
  // Asks the daemon to install `target` (ADR 0022); progress and failure arrive as ephemerals.
  updateDaemon: (target: string) => Promise<boolean>;
  // Box-side skills (protocol.md § 7 `skills.*`), used by the Settings editor and the composer's
  // slash autocomplete. `refreshSkills` never surfaces an error — an older daemon answers
  // `not_found`, which degrades to an empty list (no editor, no autocomplete). `saveSkill` and
  // `deleteSkill` report failures and re-list on success so the editor and composer stay in step.
  refreshSkills: () => Promise<void>;
  saveSkill: (name: string, body: string) => Promise<boolean>;
  deleteSkill: (name: string) => Promise<boolean>;
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

// A daemon that lacks the method answers `not_found`/`unsupported`, and an offline box rejects;
// either degrades to a `latest: null` result so Settings never offers to install what it could
// not check. A genuine result (including `latest: null` from the box) is stored as-is.
const checkUpdate = async (i: StoreInternals): Promise<void> => {
  try {
    i.state.updateCheck = await boxLink.call(i, 'daemon.checkUpdate', {});
  } catch {
    i.state.updateCheck = {
      current: i.state.daemonVersion ?? '',
      latest: null,
      available: false,
      verified: null,
    };
  }
};

// Mark the update as starting so Settings shows progress, then ask the box. A refusal (an
// `unsupported` target, say) clears the marker and rethrows so the failure reaches `state.error`;
// on success the ephemerals drive the phase and the reconnect clears the marker.
const updateDaemon = async (i: StoreInternals, target: string): Promise<void> => {
  i.state.update = { target, phase: null, failed: null };
  try {
    await boxLink.call(i, 'daemon.update', { version: target });
  } catch (error) {
    i.state.update = { target: null, phase: null, failed: null };
    throw error;
  }
};

const relistSkills = async (i: StoreInternals): Promise<void> => {
  const { skills } = await boxLink.call(i, 'skills.list', {});
  i.state.skills = skills;
};

const refreshSkills = async (i: StoreInternals): Promise<void> => {
  try {
    await relistSkills(i);
  } catch {
    // Older daemon or offline: keep any list already fetched, else show none.
    i.state.skills = i.state.skills ?? [];
  }
};

export const settingsActions = (i: StoreInternals): SettingsActions => ({
  refreshDevices: () => boxLink.attempt(i, () => refreshDevices(i)),
  removeDevice: (deviceId) => boxLink.attempt(i, () => removeDevice(i, deviceId)),
  refreshSettings: () =>
    boxLink.attempt(i, async () => {
      i.state.settings = await boxLink.call(i, 'settings.get', {});
    }),
  saveSettings: (patch) => boxLink.attempt(i, () => saveSettings(i, patch)),
  checkUpdate: () => checkUpdate(i),
  updateDaemon: (target) => boxLink.attempt(i, () => updateDaemon(i, target)),
  refreshSkills: () => refreshSkills(i),
  saveSkill: (name, body) =>
    boxLink.attempt(i, async () => {
      await boxLink.call(i, 'skills.write', { name, body });
      await relistSkills(i);
    }),
  deleteSkill: (name) =>
    boxLink.attempt(i, async () => {
      await boxLink.call(i, 'skills.delete', { name });
      await relistSkills(i);
    }),
});
