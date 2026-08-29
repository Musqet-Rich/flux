import type { FluxEvent } from '@flux/protocol';

import type { AskRegistry } from './create-ask-registry.ts';
import type { ControlRequest } from './create-control-socket.ts';
import type { EventInput, EventLog } from './create-event-log.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';

// What the control socket does with each request (ADR 0008): `ask` logs the question, parks
// the session in waiting_user until an answer or the timeout, then logs the answer; `notify`
// logs; `pair` mints a pairing URL; `devices.rm` revokes a device.

export interface ControlHandlerOptions {
  log: EventLog;
  sessions: SessionStore;
  asks: AskRegistry;
  supervisor: (record: SessionRecord) => SessionSupervisor;
  emit: (event: FluxEvent) => void;
  pairingUrl: () => string;
  revokeDevice: (deviceId: string) => Promise<void>;
  askTimeoutMs?: number;
}

const defaultAskTimeoutMs = 30 * 60 * 1000;

export const createControlHandler = (
  options: ControlHandlerOptions,
): ((request: ControlRequest, signal?: AbortSignal) => Promise<unknown>) => {
  const append = (session: string, input: EventInput): void => {
    options.emit(options.log.append(session, input));
  };
  return async (request, signal) => {
    if (request.type === 'pair') return { url: options.pairingUrl() };
    if (request.type === 'devices.rm') {
      await options.revokeDevice(request.deviceId);
      return {};
    }
    const record = options.sessions.get(request.session);
    if (request.type === 'notify') {
      append(record.session, {
        type: 'notify',
        payload: { level: request.level, summary: request.summary },
      });
      return {};
    }
    const askId = crypto.randomUUID();
    const timeoutMs = request.timeoutMs ?? options.askTimeoutMs ?? defaultAskTimeoutMs;
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
    const supervisor = options.supervisor(record);
    append(record.session, {
      type: 'ask',
      payload: {
        askId,
        question: request.question,
        ...(request.options === undefined ? {} : { options: request.options }),
        timeoutAt,
      },
    });
    supervisor.waiting(true);
    const answer = await options.asks.ask(askId, timeoutMs, signal);
    supervisor.waiting(false);
    append(record.session, {
      type: 'ask.answered',
      payload: { askId, answer: answer.answer, by: answer.by },
    });
    return answer;
  };
};
