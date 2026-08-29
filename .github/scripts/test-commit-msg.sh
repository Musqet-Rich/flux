#!/bin/sh
# Table test for .githooks/commit-msg. Run from the repo root; also run by the
# ci.yml "hooks" job. Each case is "expect<TAB>message"; expect is ok or bad.
# POSIX sh, no dependencies.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

long_ok=$(awk 'BEGIN{s="feat(daemon): "; while (length(s) < 100) s = s "x"; print s}')
long_bad=$(awk 'BEGIN{s="feat(daemon): "; while (length(s) < 101) s = s "x"; print s}')

fail=0
run() {
  expect=$1
  shift
  printf '%b' "$1" >"$tmp"
  if sh .githooks/commit-msg "$tmp" >/dev/null 2>&1; then got=ok; else got=bad; fi
  if [ "$got" = "$expect" ]; then
    printf '  pass  %-4s %s\n' "$expect" "$(printf '%b' "$1" | head -n1 | cut -c1-70)"
  else
    printf '  FAIL  want %s got %s: %s\n' "$expect" "$got" "$(printf '%b' "$1" | head -n1 | cut -c1-70)"
    fail=1
  fi
}

run ok  'feat(daemon): add session supervisor\n'
run ok  'fix(pwa): keep scroll position\n\nBody text.\n'
run ok  'docs: reword the git section\n'
run ok  'chore(repo): bump pins\n'
run ok  'refactor(protocol)!: rename frame fields\n'
run ok  'ci: run commit-msg in CI\n'
run ok  'build(relay): tsdown config\n'
run ok  'test(docs): example\n'
run ok  '\n# a comment line first\n\nfeat(relay): comments and blanks are skipped\n'
run ok  'Merge branch main into feature\n'
run ok  'Revert "feat(daemon): add session supervisor"\n'
run ok  'fixup! feat(daemon): add session supervisor\n'
run ok  "$long_ok\n"
run bad "$long_bad\n"
run bad 'Added stuff\n'
run bad 'feat: \n'
run bad 'feat:no space\n'
run bad 'feat(core): unknown scope\n'
run bad 'feat(daemon) missing colon\n'
run bad 'Feat(daemon): capitalised type\n'
run bad 'perf(daemon): type not allowed\n'
run bad 'feat(daemon):  two spaces\n'
run bad ''
run bad '\n\n# only comments\n'

if [ "$fail" -ne 0 ]; then
  echo "test-commit-msg: FAILED" >&2
  exit 1
fi
echo "test-commit-msg: all cases behaved as expected"
