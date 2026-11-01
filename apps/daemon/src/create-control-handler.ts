import type { Attachment, FluxEvent } from '@flux/protocol';
import { attachment } from '@flux/protocol';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { AskRegistry } from './create-ask-registry.ts';
import type { AttachmentStore } from './create-attachment-store.ts';
import type { ControlRequest } from './create-control-socket.ts';
import type { EventInput } from './create-event-log.ts';
import type { ManagerControlOptions } from './manager-control.ts';
import { managerControl } from './manager-control.ts';

// What the control socket does with each request: `ask` logs the question, parks the session in
// waiting_user until an answer or the timeout, then logs the answer; `notify` logs; `compact`
// sends `/compact` to the agent as a queued user turn (self-compaction, ADR 0008); `offer` copies
// a file in as an attachment and logs `file.offered` for the operator to download (ADR 0036,
// flux_file_send); `pair` mints a pairing URL; `devices.rm` revokes a device; the manager verbs
// (ADR 0025) list/open/send/close/read other sessions, each authorised against the caller's
// persisted `manager` flag.

export interface ControlHandlerOptions extends ManagerControlOptions {
  asks: AskRegistry;
  attachments: Pick<AttachmentStore, 'offer' | 'remove' | 'markSent'>;
  pairingUrl: () => string;
  revokeDevice: (deviceId: string) => Promise<void>;
  askTimeoutMs?: number;
}

const defaultAskTimeoutMs = 30 * 60 * 1000;

type OfferRequest = Extract<ControlRequest, { type: 'offer' }>;

// The agent's path is resolved against the session's worktree, where its relative paths live; a
// leading `~/` is the flux user's home, as the agent's own shell would read it.
const sourcePath = (worktree: string, path: string): string =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : resolve(worktree, path);

// The copy is taken first and the event logged after; a log that refuses the row takes the copy
// back out, so no file sits on the box that no event names. Only the append is guarded: once the
// row is in the log the file must stay, whatever the broadcast does; a rollback that fails too
// reports the append's error, the one that matters. The row is then marked sent at the event's
// seq, as a message's attachments are, so even a sweep that predates the `offered` mark (an older
// daemon run on this database) sees a sent file and keeps it. The agent gets the shape the device
// sees, so its tool result can say what it offered.
const offer = async (
  options: ControlHandlerOptions,
  worktree: string,
  request: OfferRequest,
): Promise<{ attachment: Attachment }> => {
  const source = sourcePath(worktree, request.path);
  const { id, name, mime, size } = await options.attachments.offer(request.session, source);
  const shown: Attachment = { id, name, mime, size, image: attachment.isImage(mime, size) };
  const note = request.note?.trim() ?? '';
  const payload = { attachment: shown, ...(note === '' ? {} : { note }) };
  let logged: FluxEvent;
  try {
    logged = options.log.append(request.session, { type: 'file.offered', payload });
  } catch (error) {
    await options.attachments.remove(id).catch(() => null);
    throw error;
  }
  options.emit(logged);
  // Best effort: the `offered` mark already keeps the row from this daemon's sweep, so a failed
  // update must not turn an offer the operator can see into an error for the agent.
  try {
    options.attachments.markSent([id], logged.seq);
  } catch {
    // Nothing to undo; see above.
  }
  return { attachment: shown };
};

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
      const { level, summary } = request;
      append(record.session, { type: 'notify', payload: { level, summary } });
      return {};
    }
    if (request.type === 'offer') return offer(options, record.worktree, request);
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
