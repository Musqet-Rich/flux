#!/bin/sh
# Table test for check-added-lines.sh in a throwaway git repository. Run from
# anywhere; also run by the ci.yml "hooks" job. POSIX sh and git only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-added-lines.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cd "$tmp"
git init -q -b main .
git config user.email test@example.invalid
git config user.name test
git config commit.gpgsign false
mkdir -p .github/scripts src docs test/fixtures src/comp src/styles apps/pwa/src/composables \
  apps/pwa/src/styles packages/protocol/src/__tests__
# `run` cleans untracked files, so directories the cases write into are kept in the baseline.
for d in src/comp src/styles apps/pwa/src/composables apps/pwa/src/styles packages/protocol/src/__tests__; do
  : >"$d/.gitkeep"
done
printf '# scanner\n' >.github/scripts/check-added-lines.sh
printf '# test\n' >.github/scripts/test-added-lines.sh
printf '# rules\n' >docs/engineering.md
printf 'export const a = 1;\n' >src/a.ts
git add -A && git commit -qm 'chore(repo): baseline'

fail=0
run() {
  expect=$1; name=$2
  git add -A
  if sh "$check" --staged >/dev/null 2>&1; then got=ok; else got=bad; fi
  if [ "$got" = "$expect" ]; then printf '  pass  %-4s %s\n' "$expect" "$name"
  else printf '  FAIL  want %s got %s: %s\n' "$expect" "$got" "$name"; fail=1; fi
  git reset -q --hard HEAD
  git clean -qfd
}
lines() { awk -v n="$1" -v t="$2" 'BEGIN { while (n-- > 0) print t }'; }

run ok  'nothing staged'

printf 'const y = 2;\n' >>src/a.ts
run ok  'ordinary code'

printf '// why: the relay must never see plaintext\n' >>src/a.ts
run ok  'a prose comment'

printf '// See https://example.com/spec; section 3 {details}\n' >>src/a.ts
run ok  'a comment with a URL is prose even with code punctuation'

printf '// TODO tidy this\n' >>src/a.ts
run bad 'TODO without issue reference (.ts)'

printf '# TODO: pin this\n' >>.github/other.yml
run bad 'TODO without issue reference (.yml)'

printf 'FIXME later\n' >>docs/notes.md
run bad 'FIXME without issue reference (.md)'

printf '// TODO #42: replace once ws supports it\n' >>src/a.ts
run ok  'TODO with issue reference'

printf '// todo in lower case is a word, not a marker\n' >>src/a.ts
run ok  'lower-case todo is prose'

printf 'const todoList = [];\n' >>src/a.ts
run ok  'TODO inside an identifier is not a marker'

printf '// TODO no issue, rules-allow\n' >>src/a.ts
run ok  'marker rules-allow skips the line'

printf '// const old = parse(input);\n' >>src/a.ts
run bad 'commented-out statement (const ... ;)'

printf '// import { x } from "./x";\n' >>src/a.ts
run bad 'commented-out import'

printf '// if (ready) {\n' >>src/a.ts
run bad 'commented-out block opener'

printf '// }\n' >>src/a.ts
run bad 'commented-out block closer'

printf '// return result;\n' >>src/a.ts
run bad 'commented-out return'

printf '// await socket.close();\n' >>src/a.ts
run bad 'commented-out await call'

printf '/// <reference types="vite/client" />\n' >>src/a.ts
run ok  'triple-slash directive is not a comment body'

printf '.x { /* color: red; */ }\n' >>src/a.css
run ok  'block comments are not scanned (oxlint territory)'

printf '# const x = 1;\n' >>.github/other.yml
run ok  '# comments in yml are not checked for code shapes'

printf '# echo "$x";\n' >>src/run.sh
run ok  '# comments in sh are not checked for code shapes'

lines 499 'const z = 1;' >>src/a.ts
run ok  'an existing file at exactly 500 lines'

lines 501 'const z = 1;' >src/big.ts
run bad '501 lines in a .ts file'

lines 301 'const z = 1;' >src/big.ts
run bad '301 lines in a new .ts file (a new file starts small)'

lines 300 'const z = 1;' >src/big.ts
run ok  'exactly 300 lines in a new file'

lines 301 'const y = 1;' >>src/a.ts
run ok  'an existing file grown to 302 lines is a warning, not a failure'

lines 501 'echo hi' >src/big.sh
run bad '501 lines in a .sh file'

lines 501 'line' >docs/long.md
run ok  'Markdown length is not gated'

lines 501 '{"k":1}' >src/big.json
run ok  'json length is not gated'

mkdir -p test/fixtures && lines 501 'fixture line' >test/fixtures/capture.ts
run ok  'fixtures are exempt from the length gate'

lines 501 'x: 1' >pnpm-lock.yaml
run ok  'the lockfile is exempt from the length gate'

printf '// TODO\n' >>.github/scripts/check-added-lines.sh
run ok  'the scanner itself is excluded by path'

printf 'No TODO without an issue reference\n' >>docs/engineering.md
run ok  'the rulebook is excluded by path'

# --- 4 to 7: syntax shapes on added lines.
printf '@dec export class Decorated {}\n' >>src/a.ts
run bad 'decorator on a class (.ts)'

printf '  @dec\n  method(): void {}\n' >>src/a.ts
run bad 'decorator on a method (.ts)'

printf '// @dec is banned, see engineering.md\n' >>src/a.ts
run ok  'decorator mentioned in a comment'

printf ' * @param x the input\n' >>src/a.ts
run ok  'JSDoc tag is not a decorator'

printf '<template>\n  <button\n    @click="go"\n  >x</button>\n</template>\n' >src/comp/Btn.vue
run ok  'Vue event shorthand @click is not a decorator'

printf 'const funcExpr = function (): number { return 1; };\n' >>src/a.ts
run bad 'function expression assigned to a const'

printf 'const f = { m: function named() { return 1; } };\n' >>src/a.ts
run bad 'named function expression'

printf 'const g = function* gen() { yield 1; }; // needs a generator, rules-allow\n' >>src/a.ts
run ok  'generator with rules-allow'

printf 'const desc = "a function(x) in a string";\n' >>src/a.ts
run bad 'function keyword inside a string is still refused (use rules-allow)'

printf 'const fn = (x: number): number => x;\n' >>src/a.ts
run ok  'arrow function'

printf 'const functionality = 1;\n' >>src/a.ts
run ok  'identifier starting with function is not the keyword'

printf 'throw new Error("not a package-defined subclass");\n' >>src/a.ts
run bad 'throw new Error in production code'

printf 'throw new ParseError("bad frame");\n' >>src/a.ts
run ok  'throw of a package Error subclass'

printf "import { expect, test } from 'vitest';\ntest('x', () => { expect(() => { throw new Error('boom'); }).toThrow(); });\n" >src/a.test.ts
run ok  'throw new Error inside a test file is allowed'

printf "const timers = globalThis as unknown as { setTimeout: (cb: () => void, ms: number) => void };\nawait new Promise<void>((resolve) => { timers.setTimeout(resolve, 5); });\n" >src/a.test.ts
run bad 'setTimeout reached through a cast in a test'

printf "await new Promise<void>((resolve) => { setInterval(resolve, 5); });\n" >src/a.test.ts
run bad 'setInterval in a test'

printf 'setTimeout(() => tick(), 10);\n' >>src/a.ts
run ok  'setTimeout in production code is not a sleep'

# --- 8 and 9: one primary export named after the file; composable names.
printf 'export const twoExports = 1;\nexport const other = 2;\n' >src/two-exports.ts
run bad 'two value exports in one file'

printf 'export const somethingElse = 1;\n' >src/name-mismatch.ts
run bad 'primary export not named after the file'

printf 'export const twoExports = 1;\nexport interface Other { a: number }\nexport type Kind = "a" | "b";\n' >src/two-exports.ts
run ok  'one value export plus type exports'

printf 'export class SessionSupervisor {}\n' >src/session-supervisor.ts
run ok  'PascalCase class matches kebab-case file'

printf 'export const parse = (s: string): number => 1;\nexport const format = (n: number): string => "";\n' >src/index.ts
run ok  'index.ts is exempt'

printf 'export const parse = 1;\nexport const format = 2;\n' >src/wire.test.ts
run ok  'test files are exempt from the export rule'

printf 'export interface A { a: number }\nexport interface B { b: number }\n' >src/types.ts
run ok  'a types-only file has no primary export to name'

printf 'export const useCounterThing = (): number => 1;\n' >apps/pwa/src/composables/audit-counter-thing.ts
run bad 'composable file not named useThing.ts'

printf 'export const useTwo = (): number => 1;\nexport const useOther = (): number => 2;\n' >apps/pwa/src/composables/useAuditTwo.ts
run bad 'two composables in one file'

printf 'export const useCounter = (): number => 1;\n' >apps/pwa/src/composables/useCounter.ts
run ok  'a well-formed composable'

printf "import { expect, test } from 'vitest';\ntest('x', () => { expect(1).toBe(1); });\n" >apps/pwa/src/composables/useCounter.test.ts
run ok  'composable test file'

# --- 10: Vue SFC shape.
sfc() { printf '%s\n<template>\n  <p>{{ count }}</p>\n</template>\n%s\n' "$1" "$2" >src/comp/Thing.vue; }
sfc '<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
</script>' '<style scoped>
p { color: var(--fg); }
</style>'
run ok  'well-formed SFC'

sfc '<script lang="ts">
const component = { data(): { count: number } { return { count: 0 }; } };
export default component;
</script>' ''
run bad 'Options API: <script lang="ts"> without setup'

sfc '<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({ data() { return { count: 0 }; } });
</script>' ''
run bad 'defineComponent'

sfc '<script setup>
import { ref } from "vue";
const count = ref(0);
</script>' ''
run bad '<script setup> without lang="ts"'

sfc '<script setup lang="ts">
const count = typeof this;
</script>' ''
run bad '`this` in script setup'

sfc '<script setup lang="ts">
// this is why the count starts at zero
const count = 0;
</script>' ''
run ok  '`this` in a comment is prose'

sfc '<script setup lang="ts">
const count = 0;
</script>' '<style>
p { color: var(--fg); }
</style>'
run bad 'unscoped <style>'

sfc '<script setup lang="ts">
const count = 0;
</script>' '<style lang="scss">
p { color: var(--fg); }
</style>'
run bad 'unscoped <style lang>'

sfc '<script setup lang="ts" generic="T extends string">
const count = 0;
</script>' ''
run ok  'generic script setup is still script setup'

# --- 11: protocol modules and tests are siblings.
printf 'export const frame = 1;\n' >packages/protocol/src/frame.ts
printf 'export const frame = 1;\n' >packages/protocol/src/frame.test.ts
run ok  'protocol module with its test beside it'

printf 'export const noTest = 1;\n' >packages/protocol/src/no-test.ts
run bad 'protocol module with no test file'

printf 'export const specNamed = 1;\n' >packages/protocol/src/spec-named.ts
printf 'export const specNamed = 1;\n' >packages/protocol/src/spec-named.spec.ts
run bad 'protocol test named .spec.ts'

printf 'export const far = 1;\n' >packages/protocol/src/far.ts
printf 'export const far = 1;\n' >packages/protocol/src/__tests__/far.test.ts
run bad 'protocol test in a __tests__ subdirectory'

printf 'export const frame = 1;\n' >packages/protocol/src/frame.ts
printf 'export const frame = 1;\n' >packages/protocol/src/frame.test.ts
printf 'declare const x: number;\n' >packages/protocol/src/env.d.ts
run ok  'protocol .d.ts needs no test'

# Range mode and removals.
printf '// TODO leak\n' >>src/a.ts
git add -A && git commit -qm 'chore(repo): leak' --no-verify
printf 'clean\n' >>docs/notes.md
git add -A && git commit -qm 'chore(repo): clean' --no-verify
if sh "$check" HEAD~2 HEAD~1 >/dev/null 2>&1; then got=ok; else got=bad; fi
if [ "$got" = bad ]; then echo '  pass  bad  range mode: base..head catches the TODO'
else echo '  FAIL  want bad got ok: range mode'; fail=1; fi
if sh "$check" HEAD~1 HEAD >/dev/null 2>&1; then got=ok; else got=bad; fi
if [ "$got" = ok ]; then echo '  pass  ok   range mode: later clean range is fine'
else echo '  FAIL  want ok got bad: range mode clean'; fail=1; fi
sed -i.bak '/TODO/d' src/a.ts && rm -f src/a.ts.bak
git add -A
if sh "$check" --staged >/dev/null 2>&1; then echo '  pass  ok   removing a TODO is allowed'
else echo '  FAIL  want ok got bad: removal'; fail=1; fi
git reset -q --hard HEAD
if sh "$check" >/dev/null 2>&1; then echo '  FAIL  want bad got ok: usage'; fail=1
else echo '  pass  bad  usage: no arguments'; fi

if [ "$fail" -ne 0 ]; then echo "test-added-lines: FAILED" >&2; exit 1; fi
echo "test-added-lines: all cases behaved as expected"
