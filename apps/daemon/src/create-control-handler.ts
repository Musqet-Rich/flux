import type { AskRegistry } from './create-ask-registry.ts';
import type { ControlRequest } from './create-control-socket.ts';
import type { EventInput } from './create-event-log.ts';
import type { ManagerControlOptions } from './manager-control.ts';
import { managerControl } from './manager-control.ts';

// What the control socket does with each request: `ask` logs the question, parks the session in
// waiting_user until an answer or the timeout, then logs the answer; `notify` logs; `compact`
// sends `/compact` to the agent as a queued user turn (self-compaction, ADR 0008); `pair` mints a
// pairing URL; `devices.rm` revokes a device; the manager verbs (ADR 0025) list/open/send/close/
// read other sessions, each authorised against the caller's persisted `manager` flag.

export interface ControlHandlerOptions extends ManagerControlOptions {
  asks: AskRegistry;
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
    // The manager verbs authorise the caller themselves (ADR 0025 §5) before touching any session.
    if (managerControl.is(request)) return managerControl.handle(options, request);
    const record = options.sessions.get(request.session);
    if (request.type === 'notify') {
      append(record.session, {
        type: 'notify',
        payload: { level: request.level, summary: request.summary },
      });
      return {};
    }
    if (request.type === 'compact') {
      const text = request.focus === undefined ? '/compact' : `/compact ${request.focus}`;
      await options.supervisor(record).send(text);
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
