import { expect, test } from 'vitest';

import { transcriptPath } from './transcript-path.ts';

test('the path is the config dir, the cwd slugged to [A-Za-z0-9-], and the session id', () => {
  expect(transcriptPath('/private/tmp/flux.work_tree/x', 'abc', '/cfg')).toBe(
    '/cfg/projects/-private-tmp-flux-work-tree-x/abc.jsonl',
  );
});
