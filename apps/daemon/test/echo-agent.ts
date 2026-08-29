#!/usr/bin/env node
// A stand-in agent that writes every stdin line back to stdout unchanged, so a test can see
// exactly what the daemon sends an agent (the shape of a message with image blocks, say).
// Flags are accepted and ignored; end of stdin ends the process.
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line.trim() !== '') process.stdout.write(`${line}\n`);
});
input.on('close', () => {
  process.exit(0);
});
