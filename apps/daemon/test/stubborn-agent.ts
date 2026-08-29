#!/usr/bin/env node
// A stand-in for an agent that will not leave: what `claude` looks like to the daemon while
// blocked inside an MCP call. It ignores SIGTERM and the end of stdin, so only SIGKILL ends it.
// A listening socket keeps the event loop alive without a timer (which the test lint bans).
// It prints `ready` once the handler is in place: a SIGTERM sent before that would still end
// it, so a test waits for the line before it starts closing.
// Node 24 runs this .ts directly (type stripping), so it needs no build step.
import { createServer } from 'node:net';

process.on('SIGTERM', () => {});
process.stdin.resume();
createServer().listen(0, () => {
  process.stdout.write('ready\n');
});
