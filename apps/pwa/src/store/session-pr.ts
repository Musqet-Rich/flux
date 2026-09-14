import type { EventPayloads } from '@flux/protocol';

import type { LogFold } from './log-fold.ts';
import { logFold } from './log-fold.ts';

// The session's pull request, if one has been published: the latest `pr.published` in the log,
// whether the agent opened it with `gh` or the operator did from the changes screen. The box
// logs both, so this is the one place the PWA learns of a PR (protocol.md § 5).

export const sessionPr: LogFold<EventPayloads['pr.published'] | null> =
  logFold.latest('pr.published');
