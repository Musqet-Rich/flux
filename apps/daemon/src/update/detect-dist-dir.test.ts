import { expect, test } from 'vitest';

import { detectDistDir } from './detect-dist-dir.ts';

const always = { exists: (): boolean => true };
const never = { exists: (): boolean => false };

test('an installed index.mjs with its sibling bundles resolves the dist dir', () => {
  expect(detectDistDir('/opt/flux/dist/index.mjs', always)).toBe('/opt/flux/dist');
});

test('a missing sibling bundle is a dev build (null)', () => {
  expect(detectDistDir('/opt/flux/dist/index.mjs', never)).toBeNull();
});

test('running from a .ts source entry is a dev build (null)', () => {
  expect(detectDistDir('/home/me/flux/apps/daemon/src/index.ts', always)).toBeNull();
});

test('no argv entry is a dev build (null)', () => {
  expect(detectDistDir('', always)).toBeNull();
});

test('only the sibling bundles are probed, from the entry directory', () => {
  const probed: string[] = [];
  const result = detectDistDir('/opt/flux/dist/index.mjs', {
    exists: (path) => {
      probed.push(path);
      return true;
    },
  });
  expect(result).toBe('/opt/flux/dist');
  expect(probed).toEqual(['/opt/flux/dist/flux-mcp.mjs', '/opt/flux/dist/flux-pi-extension.mjs']);
});
