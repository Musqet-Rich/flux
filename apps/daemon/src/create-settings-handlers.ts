import type { Device, RpcMethods, Settings } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';

// Device and settings methods of protocol.md § 7 (prd.md P2: pair a second device, revoke a
// device, edit the box-side and harness config from the PWA).

export type SettingsHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'devices.list' | 'devices.remove' | 'settings.get' | 'settings.set'
>;

const listDevices = (ctx: HandlerContext, peer: Peer): Device[] =>
  ctx.devices.devices().map((d) => {
    const { deviceId, name, pairedAt } = d;
    const device: Device = {
      deviceId,
      name,
      pairedAt,
      current: deviceId === peer.device?.deviceId,
    };
    if (d.lastSeenAt !== null) device.lastSeenAt = d.lastSeenAt;
    return device;
  });

const readSettings = async (ctx: HandlerContext): Promise<Settings> => ({
  flux: ctx.settings.get(),
  env: ctx.env,
  harnessConfig: await ctx.harnessConfig.read(),
});

export const createSettingsHandlers = (ctx: HandlerContext): SettingsHandlers => ({
  'devices.list': (_p, peer) => Promise.resolve(listDevices(ctx, peer)),
  'devices.remove': async (p) => {
    if (ctx.devices.devices().every((d) => d.deviceId !== p.deviceId)) {
      throw new DaemonError('not_found', `no device ${p.deviceId}`);
    }
    await ctx.revokeDevice(p.deviceId);
    return {};
  },
  'settings.get': () => readSettings(ctx),
  'settings.set': async (p) => {
    // Both halves are checked before either is written, and the files go first: a failed file
    // write then leaves the database untouched too.
    if (p.harnessConfig !== undefined) ctx.harnessConfig.check(p.harnessConfig);
    if (p.flux !== undefined) ctx.settings.check(p.flux);
    const harness = p.flux?.defaultHarness;
    if (harness !== undefined && !ctx.agents.includes(harness)) {
      throw new DaemonError('agent_unavailable', `${harness} is not installed on the box`);
    }
    if (p.harnessConfig !== undefined) await ctx.harnessConfig.write(p.harnessConfig);
    if (p.flux !== undefined) ctx.settings.set(p.flux);
    return readSettings(ctx);
  },
});
