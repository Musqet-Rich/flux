import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test } from 'vitest';

import { detectAgents } from './detect-agents.ts';

const bin = (dir: string, name: string, executable: boolean): string => {
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, executable ? 0o755 : 0o644);
  return file;
};

test('finds bare names on PATH and paths as given, only when executable', () => {
  const a = mkdtempSync(join(tmpdir(), 'flux-agents-a-'));
  const b = mkdtempSync(join(tmpdir(), 'flux-agents-b-'));
  bin(a, 'claude', true);
  const pi = bin(b, 'pi', true);
  const path = [a, '', '/nowhere'].join(delimiter);
  expect(detectAgents({ claude: 'claude', pi: 'pi', path })).toEqual(['claude']);
  expect(detectAgents({ claude: 'claude', pi, path })).toEqual(['claude', 'pi']);
  expect(detectAgents({ claude: 'claude', pi: `${b}/pi`, path: '' })).toEqual(['pi']);
  bin(b, 'claude', false);
  expect(detectAgents({ claude: join(b, 'claude'), pi: 'pi', path: b })).toEqual(['pi']);
  expect(detectAgents({ claude: 'nope', pi: 'nope', path })).toEqual([]);
});

test('defaults to the process PATH', () => {
  expect(detectAgents({ claude: 'sh', pi: 'no-such-binary-anywhere' })).toEqual(['claude']);
});
