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

const none = 'no-such-binary-anywhere';

test('finds bare names on PATH and paths as given, only when executable', () => {
  const a = mkdtempSync(join(tmpdir(), 'flux-agents-a-'));
  const b = mkdtempSync(join(tmpdir(), 'flux-agents-b-'));
  bin(a, 'claude', true);
  const pi = bin(b, 'pi', true);
  const opencode = bin(b, 'opencode', true);
  const path = [a, '', '/nowhere'].join(delimiter);
  expect(detectAgents({ claude: 'claude', pi: none, opencode: none, path })).toEqual(['claude']);
  expect(detectAgents({ claude: 'claude', pi, opencode, path })).toEqual([
    'claude',
    'pi',
    'opencode',
  ]);
  expect(detectAgents({ claude: 'claude', pi: `${b}/pi`, opencode: none, path: '' })).toEqual([
    'pi',
  ]);
  expect(detectAgents({ claude: 'nope', pi: 'nope', opencode, path: b })).toEqual(['opencode']);
  bin(b, 'claude', false);
  expect(detectAgents({ claude: join(b, 'claude'), pi: 'pi', opencode: none, path: b })).toEqual([
    'pi',
  ]);
  expect(detectAgents({ claude: 'nope', pi: 'nope', opencode: 'nope', path })).toEqual([]);
});

test('defaults to the process PATH', () => {
  expect(detectAgents({ claude: 'sh', pi: none, opencode: none })).toEqual(['claude']);
});
