#!/bin/sh
# Table test for check-dep-ledger.sh in a throwaway git repository. Run from
# anywhere; also run by the ci.yml "hooks" job. POSIX sh, git, node (24).
set -u
here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-dep-ledger.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cd "$tmp"
git init -q -b main .
git config user.email test@example.invalid
git config user.name test
git config commit.gpgsign false
mkdir -p docs/adr apps/relay
# A ledger with the step-2 columns; `row name version` makes one complete row.
cols='| package | app | version | why | weekly downloads | maintainer | licence | transitive deps | notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
ledger() { printf '# ledger\n\n%b%b' "$cols" "$1" >docs/adr/0010-dependencies.md; }
row() { printf '| `%s` | root | %s | does a thing the platform has no API for and our own code would get wrong | 2.1M/wk | someone | MIT | 0 | |\\n' "$1" "${2:-pin at add}"; }
pkg() { printf '{"name":"x","dependencies":{%s},"devDependencies":{%s}}\n' "$1" "${2:-}" >"$3"; }

ledger "$(row hono)$(row ws)"
ws() { printf 'packages:\n  - apps/*\nonlyBuiltDependencies: %s\n' "$1" >pnpm-workspace.yaml; }
ws '[]'
pkg '"hono":"4.13.5"' '' package.json
pkg '"ws":"8.21.3","@flux/protocol":"workspace:*"' '' apps/relay/package.json
git add -A && git commit -qm 'chore(repo): baseline'

fail=0
run() {
  expect=$1; name=$2; shift 2
  if "$@" >/dev/null 2>&1; then got=ok; else got=bad; fi
  if [ "$got" = "$expect" ]; then printf '  pass  %-4s %s\n' "$expect" "$name"
  else printf '  FAIL  want %s got %s: %s\n' "$expect" "$got" "$name"; fail=1; fi
}
staged() { git add -A && sh "$check" --staged; }
reset()  { git reset -q --hard HEAD; }

run ok  'no package.json change'                           sh "$check" --staged
pkg '"hono":"4.13.5","zod":"3.0.0"' '' package.json
run bad 'new runtime dep, ledger untouched'                staged; reset
pkg '"hono":"4.13.5"' '"oxlint":"1.80.0"' package.json
run bad 'new dev dep, ledger untouched'                    staged; reset
pkg '"hono":"4.13.5"' '"oxlint":"1.80.0"' package.json; ledger "$(row hono)$(row ws)$(row oxlint 1.80.0)"
run ok  'new dev dep with ledger line in same change'      staged; reset
pkg '"hono":"4.14.0"' '' package.json
run ok  're-pin of a ledgered package'                     staged; reset
pkg '"hono":"4.13.5"' '"@types/node":"26.4.0"' package.json; ledger "$(row hono)$(row ws)$(row @types/node-fetch 26.4.0)"
run bad 'similar name does not count (@types/node vs @types/node-fetch)' staged; reset
pkg '"ws":"8.21.3","@flux/protocol":"workspace:^"' '' apps/relay/package.json
run ok  'workspace: spec change is skipped'                staged; reset
pkg '' '' package.json
run ok  'removal needs nothing'                            staged; reset
pkg '"hono":"4.13.5","zod":"3.0.0"' '' package.json; git commit -qam 'chore(repo): add zod' --no-verify
run bad 'range mode: base..head catches an unledgered add' sh "$check" HEAD~1 HEAD
run ok  'range mode: identical revisions'                  sh "$check" HEAD HEAD
ledger "$(row hono)$(row ws)$(row zod 3.0.0)"; git commit -qam 'docs: ledger zod' --no-verify
run ok  'range mode: ledger line in a later commit of the same range' sh "$check" HEAD~2 HEAD
# Row completeness for a package first ledgered in the change (multi-column table).
wide() { printf '# ledger\n\n%b| `hono` | relay | pin at add | router | at add | at add | at add | at add | |\n%b' "$cols" "$1" >docs/adr/0010-dependencies.md; }
full='| `left-pad` | root | 1.3.0 | Pads a string on the left; String.prototype.padStart is not in our target and polyfilling it is longer | 2.1M/wk | stevemao | WTFPL | 0 | |\n'
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | | | | | | | |\n'
run bad 'new dep with an empty-celled ledger row'          staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | pin at add | pads | 2.1M | stevemao | WTFPL | 0 | |\n'
run bad 'new dep whose version cell is a placeholder'      staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide "$full"
run ok  'new dep with a complete row (notes may be empty)' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | 1.3.0 | pads left | many | stevemao | WTFPL | few | |\n'
run bad 'new dep whose downloads and transitive cells hold no number' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | 1.3.0 | tbd | 1 | x | x | 0 | |\n'
run bad 'new dep with every cell filled by a placeholder (tbd, x)' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | 1.3.0 | pads strings | 2M | stevemao | WTFPL | 0 | |\n'
run bad 'new dep whose why cell says what, not why not the platform (under 8 words)' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | 1.3.0 | Padding. See 0013. | 2M | stevemao | WTFPL | 0 | |\n'
run ok  'new dep whose short why cell points at an ADR' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '| `left-pad` | root | 1.3.0 | Pads a string on the left; String.prototype.padStart is not in our target and polyfilling it is longer | 2M | - | ? | 0 | |\n'
run bad 'new dep whose maintainer and licence cells are marks, not names' staged; reset
narrow() { printf '# ledger\n\n| package | app | version | why | notes |\n| --- | --- | --- | --- | --- |\n| `hono` | relay | pin at add | router | |\n%s' "$1" >docs/adr/0010-dependencies.md; }
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; narrow '| `left-pad` | root | 1.3.0 | pads left | |\n'
run bad 'new dep in a table without downloads/maintainer/licence/transitive columns' staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide '\nWe also use `left-pad`.\n'
run bad 'new dep named in prose, no table row'             staged; reset
pkg '"hono":"4.13.5","left-pad":"1.3.0"' '' package.json; wide "\nPending.\n$full"
run bad 'new dep in a lone | line after prose, not a table' staged; reset
pkg '"hono":"4.14.0"' '' package.json; wide ''
run ok  're-pin of an already-ledgered placeholder row is free' staged; reset
ws '[esbuild]'
run bad 'onlyBuiltDependencies gains a package, ledger untouched' staged; reset
ws '[esbuild]'; ledger "$(row hono)$(row ws)$(row esbuild)"
run ok  'onlyBuiltDependencies gains a ledgered package'   staged; reset
printf 'packages:\n  - apps/*\nonlyBuiltDependencies:\n  # native build\n  - esbuild\n  - "sharp" # images\n' >pnpm-workspace.yaml
run bad 'onlyBuiltDependencies block list, two unledgered' staged; reset
printf 'packages:\n  - apps/*\nonlyBuiltDependencies:\n  - esbuild\n' >pnpm-workspace.yaml; ledger "$(row hono)$(row ws)$(row esbuild)"
run ok  'onlyBuiltDependencies block list, ledgered'       staged; reset
printf 'packages:\n  - apps/*\nonlyBuiltDependencies: 3\n' >pnpm-workspace.yaml
run bad 'onlyBuiltDependencies in an unreadable shape fails closed' staged; reset
printf 'packages:\n  - apps/*\n  - packages/*\nonlyBuiltDependencies: []\n' >pnpm-workspace.yaml
run ok  'workspace change that leaves the allow-list alone' staged; reset
rm docs/adr/0010-dependencies.md; pkg '"hono":"4.13.5"' '"oxlint":"1.80.0"' package.json
run bad 'ledger file deleted'                              staged; reset
run bad 'usage: no arguments'                              sh "$check"

if [ "$fail" -ne 0 ]; then echo "test-dep-ledger: FAILED" >&2; exit 1; fi
echo "test-dep-ledger: all cases behaved as expected"
