#!/bin/sh
# Enforce the engineering.md rules that live on a diff or on a file's shape, not
# in a linter's rule set (oxlint 1.80 has no no-restricted-syntax and no rule for
# export/filename agreement), so they hold for every file type and not only the
# .ts/.vue files oxlint sees. Added lines:
#   1. "No TODO without an issue reference": an added line containing the word
#      TODO, FIXME or XXX (upper case) must also contain `#<number>` on the same
#      line. (oxlint bans the markers outright in .ts/.vue; this is the wider
#      net for everything else and keeps the wording of the rule.)
#   2. "No commented-out code": an added `//` comment line in a .ts/.js/.vue/.css
#      file whose text is shaped like a statement (ends in `;`, `{` or `})`, or
#      starts with import/export/const/let/return/if (/for (/await) fails.
#   4. "No decorators": an added .ts line starting with `@name` fails. tsconfig
#      erasableSyntaxOnly does not cover decorators and Node type stripping
#      rejects them at runtime.
#   5. "No `function` declarations or expressions": an added .ts/.vue line with
#      a `function (` / `function name(` keyword fails (oxlint func-style only
#      sees declarations). A generator or real-`this` case carries `rules-allow`
#      and a comment saying why.
#   6. "Throw Error subclasses defined in the package": an added
#      `throw new Error(` in non-test .ts/.vue fails.
#   7. "No sleeps; await the thing": an added `setTimeout(` / `setInterval(` in
#      a *.test.ts fails (oxlint's globals rule is bypassed by a cast).
# Touched files, on the new side:
#   3. "A file over 300 lines is a smell; over 500 is a review blocker": any
#      source file touched by the change that is over 500 lines fails (.ts .js
#      .vue .css .sh .yml). A file ADDED by the change fails at 300: a new file
#      is born at the size we want, so the smell is a blocker for it; a file
#      that already existed and grows past 300 prints a warning, so a one-line
#      fix to an existing large file is not held hostage to a split. Fixtures (`test/fixtures/`),
#      `*.json`, lockfiles and Markdown are exempt: data and prose, not code.
#      oxlint `max-lines` holds the same limit for .ts/.vue; this also covers
#      the files it does not lint.
#   8. "One primary export per file, named the same as the file": a touched
#      .ts file (not a test, not index.ts, not *.config.ts, not *.d.ts) with
#      more than one `export const|let|function|class` fails, and with exactly
#      one, the exported name must equal the file name (case and dashes
#      ignored: `two-exports.ts` exports `twoExports`, `session-supervisor.ts`
#      may export `SessionSupervisor`). Type exports are secondaries and free.
#   9. Composables are `apps/pwa/src/composables/useThing.ts`: any other .ts
#      name in that directory fails.
#  10. Vue SFCs: every `<script>` block is `<script setup lang="ts">`, no
#      `defineComponent(`, no `this` in the script, every `<style>` is scoped,
#      and no hex/rgb()/hsl() colour literal in a style block (theme comes from
#      CSS custom properties). The colour check also runs on touched .css files
#      other than src/styles/base.css. "Templates stay dumb": inside the root
#      `<template>`, a mustache or a bound directive value (v-if/v-show/v-for/
#      v-bind/:prop/v-model/v-html/v-text) containing a call `(`, an arrow
#      `=>`, a logical operator (`&&` `||` `??`) or an arithmetic operator
#      between two operands (`+ - * / %`) fails (one ternary, a comparison and
#      property access are fine); an event handler (`@x`/`v-on:x`) may be one
#      direct call but no arrow or chained call. The root template is checked
#      as one record, so an expression the formatter wrapped across lines is
#      seen whole.
#  11. packages/protocol: every `thing.ts` under src has `thing.test.ts` next
#      to it and every test file sits next to its module (so `.spec.ts` and
#      `__tests__/` are refused); a module a test never imports would otherwise
#      never appear in the coverage table and the 100% gate could not see it.
# A line carrying the marker `rules-allow` is skipped (visible in review).
#
#   check-added-lines.sh --staged        HEAD vs the index (pre-commit hook)
#   check-added-lines.sh <base> <head>   two revisions (CI, push and pull_request)
#
# This script, its test and docs/engineering.md (which states the rules) are
# excluded by path: they contain the shapes.
# No dependencies beyond git and POSIX sh (awk, grep, wc).
set -eu

case "${1:-}" in
  --staged)
    [ "$#" -eq 1 ] || { echo "usage: $0 --staged | <base> <head>" >&2; exit 2; }
    base=HEAD
    head=
    git rev-parse -q --verify HEAD^{commit} >/dev/null 2>&1 || base=$(git hash-object -t tree /dev/null)
    diff_args="--cached $base"
    ;;
  '')
    echo "usage: $0 --staged | <base> <head>" >&2; exit 2 ;;
  *)
    [ "$#" -eq 2 ] || { echo "usage: $0 --staged | <base> <head>" >&2; exit 2; }
    base=$1
    head=$2
    diff_args="$base $head"
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

exclude=":(exclude).github/scripts/check-added-lines.sh :(exclude).github/scripts/test-added-lines.sh :(exclude)docs/engineering.md"
max_lines=500
smell_lines=300
status=0

# The new side of a path: the index in --staged mode, $head in range mode.
show() { if [ -z "$head" ]; then git show ":$1"; else git show "$head:$1"; fi; }
# Every path on the new side under a prefix.
tree() { if [ -z "$head" ]; then git ls-files --cached -- "$1"; else git ls-tree -r --name-only "$head" -- "$1"; fi; }
report() { echo "check-added-lines: $1:" >&2; printf '%s\n' "$2" | cut -c1-120 | sed 's/^/  /' >&2; status=1; }

# --- 1 and 2: added lines, tagged path:line:text (same shape as check-secrets).
# shellcheck disable=SC2086
added=$(git diff --no-color --no-ext-diff --no-textconv --diff-filter=AM -U0 $diff_args -- . $exclude \
  | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^@@/ { n = $3; sub(/^\+/, "", n); sub(/,.*/, "", n); line = n + 0; next }
    /^\+/ { printf "%s:%d:%s\n", file, line, substr($0, 2); line++; next }
  ' | grep -v 'rules-allow' || true)

if [ -n "$added" ]; then
  todo=$(printf '%s\n' "$added" \
    | grep -E '(^|[^[:alnum:]_])(TODO|FIXME|XXX)([^[:alnum:]_]|$)' \
    | { grep -E -v '#[0-9]+' || true; })
  [ -z "$todo" ] || report "TODO/FIXME/XXX without an issue reference (#123) (docs/engineering.md § Code style)" "$todo"

  # Only source files. The comment body after `//` is matched against statement
  # shapes; a body with a URL is prose.
  code_like='^(import[[:space:]]|export[[:space:]]|const[[:space:]]|let[[:space:]]|var[[:space:]]|return([[:space:]]|;)|if[[:space:]]?\\(|for[[:space:]]?\\(|while[[:space:]]?\\(|await[[:space:]]|[[:alnum:]_.)]+;$|.*[{]$|.*[}]\\)?;?$)'
  commented=$(printf '%s\n' "$added" \
    | grep -E '^[^:]+\.(ts|mts|js|mjs|vue|css):[0-9]+:' \
    | awk -F: -v re="$code_like" '{
        path = $1; text = substr($0, length($1) + length($2) + 3);
        sub(/^[[:space:]]+/, "", text);
        if (text !~ /^\/\/[^\/]/) next;
        body = substr(text, 3);
        sub(/^[[:space:]]+/, "", body);
        if (body ~ re && body !~ /https?:\/\//) printf "%s:%s:%s\n", path, $2, body;
      }' || true)
  [ -z "$commented" ] || report "commented-out code (docs/engineering.md § Code style: delete it, git has it)" "$commented"

  # --- 4 to 7: syntax shapes on added .ts/.vue lines. Comment lines (`//`, `*`)
  # are skipped so prose can mention the keyword.
  code=$(printf '%s\n' "$added" | grep -E '^[^:]+\.(ts|mts|vue):[0-9]+:' \
    | { grep -E -v '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' || true; })
  ts_code=$(printf '%s\n' "$code" | { grep -E '^[^:]+\.(ts|mts):[0-9]+:' || true; })
  prod_code=$(printf '%s\n' "$code" | { grep -E -v '^([^:]*/)?test/|^[^:]+\.test\.ts:' || true; })
  test_code=$(printf '%s\n' "$code" | { grep -E '^[^:]+\.test\.ts:' || true; })

  decorators=$(printf '%s\n' "$ts_code" | { grep -E '^[^:]+:[0-9]+:[[:space:]]*@[A-Za-z_$]' || true; })
  [ -z "$decorators" ] || report "decorator (docs/engineering.md § TypeScript: no decorators; Node type stripping cannot run them)" "$decorators"

  functions=$(printf '%s\n' "$code" \
    | { grep -E '(^|[^[:alnum:]_$.])function[[:space:]]*(\*[[:space:]]*)?[A-Za-z0-9_$]*[[:space:]]*\(' || true; })
  [ -z "$functions" ] || report "function keyword (docs/engineering.md § Code style: arrow functions everywhere; a needed generator or this-binding gets rules-allow and a comment why)" "$functions"

  plain_throw=$(printf '%s\n' "$prod_code" | { grep -E '(^|[^[:alnum:]_$])throw[[:space:]]+new[[:space:]]+Error[[:space:]]*\(' || true; })
  [ -z "$plain_throw" ] || report "throw new Error (docs/engineering.md § TypeScript: throw an Error subclass defined in the package)" "$plain_throw"

  sleeps=$(printf '%s\n' "$test_code" | { grep -E '(^|[^[:alnum:]_$])(setTimeout|setInterval)[[:space:]]*\(' || true; })
  [ -z "$sleeps" ] || report "timer in a test (docs/engineering.md § Testing: no sleeps; await the thing, or vi.useFakeTimers)" "$sleeps"
fi

# --- 3, 8, 9, 10: touched source files on the new side.
# shellcheck disable=SC2086
files=$(git diff --name-only --diff-filter=AM $diff_args -- . $exclude \
  | grep -E '\.(ts|mts|js|mjs|vue|css|sh|ya?ml)$' \
  | grep -v -E '(^|/)test/fixtures/|(^|/)pnpm-lock\.yaml$' || true)
# shellcheck disable=SC2086
new_files=$(git diff --name-only --diff-filter=A $diff_args -- . $exclude || true)
for f in $files; do
  n=$(show "$f" | wc -l | tr -d ' ')
  if [ "$n" -gt "$max_lines" ]; then
    echo "check-added-lines: $f is $n lines; over $max_lines is a review blocker (docs/engineering.md § Code style), split it" >&2
    status=1
  elif [ "$n" -gt "$smell_lines" ] && printf '%s\n' "$new_files" | grep -qxF "$f"; then
    echo "check-added-lines: $f is a new file of $n lines; over $smell_lines is a smell (docs/engineering.md § Code style), a new file starts small, split it" >&2
    status=1
  elif [ "$n" -gt "$smell_lines" ]; then
    echo "check-added-lines: warning: $f is $n lines; over $smell_lines is a smell (docs/engineering.md § Code style)" >&2
  fi

  case "$f" in
    apps/pwa/src/composables/*.ts)
      case "$(basename "$f")" in
        use[A-Z]*.ts) ;;
        *) echo "check-added-lines: $f: composables are src/composables/useThing.ts (docs/engineering.md § Vue)" >&2; status=1 ;;
      esac ;;
  esac

  case "$f" in
    *.test.ts|*/test/*|*.d.ts|*.config.ts|*.config.mts|*/index.ts|index.ts) ;;
    *.ts|*.mts)
      exports=$(show "$f" | grep -v 'rules-allow' \
        | { grep -E -o '^export[[:space:]]+(async[[:space:]]+)?(const|let|var|function\*?|class|abstract[[:space:]]+class)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*' || true; } \
        | awk '{ print $NF }')
      count=$(printf '%s\n' "$exports" | sed '/^$/d' | wc -l | tr -d ' ')
      if [ "$count" -gt 1 ]; then
        echo "check-added-lines: $f has $count value exports ($(printf '%s' "$exports" | paste -sd ' ' -)); one primary export per file (docs/engineering.md § Code style)" >&2
        status=1
      elif [ "$count" -eq 1 ]; then
        stem=$(basename "$f"); stem=${stem%.*}
        want=$(printf '%s' "$stem" | tr -d '_-' | tr '[:upper:]' '[:lower:]')
        got=$(printf '%s' "$exports" | tr -d '$' | tr '[:upper:]' '[:lower:]')
        if [ "$want" != "$got" ]; then
          echo "check-added-lines: $f exports \`$exports\`; the primary export is named the same as the file (docs/engineering.md § Code style)" >&2
          status=1
        fi
      fi ;;
  esac

  case "$f" in
    *.vue)
      vue=$(show "$f" | awk '
        function trim(s) { gsub(/[[:space:]]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return substr(s, 1, 60) }
        function logic(e,    o) {
          if (e ~ /=>|[A-Za-z0-9_$\]\)][[:space:]]*\(/) return 1
          o = e; gsub(/\047[^\047]*\047|"[^"]*"|`[^`]*`/, "S", o)
          if (o ~ /&&|\|\||\?\?/) return 1
          # An operand, then an operator, then an operand: `a + b`, `a*b`, `(a - b) % 2`, `s+ "x"`. A
          # sign in front of a literal (`-1`) and `++`/`--` have no operand on both sides.
          if (o ~ /[A-Za-z0-9_$\)\]][[:space:]]*[-+*\/%][[:space:]]*[A-Za-z0-9_$\(]/) return 1
          return 0
        }
        /rules-allow/ { next }
        /<script([[:space:]>]|$)/ {
          if ($0 !~ /<script setup lang="ts"([[:space:]>])/) print "script block is not <script setup lang=\"ts\"> (Composition API only, TypeScript only)";
          in_script = 1
        }
        /<\/script>/ { in_script = 0 }
        /<style([[:space:]>]|$)/ {
          if ($0 !~ /<style[^>]*[[:space:]]scoped([[:space:]>=])/) print "style block is not scoped";
          in_style = 1
        }
        /<\/style>/ { in_style = 0 }
        /^<template([[:space:]>]|$)/ { in_template = 1 }
        /^<\/template>/ {
          in_template = 0
          # A mustache or a bound directive value (v-if, v-show, v-for, v-bind/:prop, v-model,
          # v-html, v-text) may not call anything, hold an arrow, or combine operands with an
          # arithmetic or logical operator (+ - * / % && || ??); a single ternary, a comparison
          # and property access are fine. Quoted strings are blanked first so their contents
          # are not read as operators. An event handler (@x / v-on:x) may be one direct call
          # (`@click="emit(\047save\047)"`) but no arrow and no chained call.
          text = tpl
          while (match(text, /\{\{[^}]*\}\}/)) {
            expr = substr(text, RSTART + 2, RLENGTH - 4)
            if (logic(expr)) print "logic in template mustache (" trim(expr) "): compute it in <script>"
            text = substr(text, RSTART + RLENGTH)
          }
          text = tpl
          while (match(text, /(v-(if|else-if|show|for|bind|model|html|text)|:[A-Za-z][-A-Za-z0-9.:]*)="[^"]*"/)) {
            expr = substr(text, RSTART, RLENGTH); sub(/^[^=]*="/, "", expr); sub(/"$/, "", expr)
            if (logic(expr)) print "logic in template directive (" trim(expr) "): compute it in <script>"
            text = substr(text, RSTART + RLENGTH)
          }
          text = tpl
          while (match(text, /(@[A-Za-z][-A-Za-z0-9.:]*|v-on:[-A-Za-z0-9.:]+)="[^"]*"/)) {
            expr = substr(text, RSTART, RLENGTH); sub(/^[^=]*="/, "", expr)
            if (expr ~ /=>|\)[[:space:]]*\.|\.[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*\(.*\(/) print "logic in event handler (" trim(expr) "): one direct call at most, no arrow, no chain"
            text = substr(text, RSTART + RLENGTH)
          }
          tpl = ""
        }
        /defineComponent[[:space:]]*\(/ { print "defineComponent(): Options API / mixins are banned" }
        # Templates stay dumb. The root template is gathered into one record (a
        # formatter wraps a long expression across lines, so a per-line check would
        # miss exactly the expressions this rule exists for) and checked at </template>.
        in_template { tpl = tpl " " $0 }
        in_script {
          line = $0; sub(/\/\/.*/, "", line);
          if (line ~ /(^|[^[:alnum:]_$.\047"])this([^[:alnum:]_$\047"]|$)/) print "`this` in script (line " NR ")"
        }
        in_style && /:[^;{]*(#[0-9a-fA-F]{3,8}([^[:alnum:]_-]|$)|(rgb|hsl)a?[[:space:]]*\()/ { print "colour literal in style (line " NR "): use a CSS custom property" }
      ')
      [ -z "$vue" ] || report "$f (docs/engineering.md § Vue)" "$vue" ;;
    apps/pwa/src/styles/base.css) ;;
    *.css)
      colours=$(show "$f" | grep -v 'rules-allow' \
        | { grep -n -E ':[^;{]*(#[0-9a-fA-F]{3,8}([^[:alnum:]_-]|$)|(rgb|hsl)a?[[:space:]]*\()' || true; })
      [ -z "$colours" ] || report "$f: colour literal outside src/styles/base.css (docs/engineering.md § Vue: CSS custom properties for theme)" "$colours" ;;
  esac
done

# --- 11: protocol modules and tests are siblings, on the whole new-side tree.
protocol=$(tree packages/protocol/src | { grep -E '\.ts$' || true; } | { grep -v -E '\.d\.ts$' || true; })
if [ -n "$protocol" ]; then
  siblings=$(printf '%s\n' "$protocol" | awk '
    { seen[$0] = 1; all[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        f = all[i]
        if (f ~ /\.test\.ts$/) { m = f; sub(/\.test\.ts$/, ".ts", m); if (!(m in seen)) print f ": no module " m " beside it (tests are thing.test.ts next to thing.ts)" }
        else { t = f; sub(/\.ts$/, ".test.ts", t); if (!(t in seen)) print f ": no " t " beside it (every protocol module has a test file next to it)" }
      }
    }')
  [ -z "$siblings" ] || report "packages/protocol layout (docs/engineering.md § Testing)" "$siblings"
fi

if [ "$status" -eq 0 ]; then
  count=$(printf '%s\n' "$added" | sed '/^$/d' | wc -l | tr -d ' ')
  echo "check-added-lines: $count added line(s) checked; no TODO without issue, commented-out code, decorator, function keyword, plain Error, test timer, oversize file, multi-export file, misnamed export, non-setup SFC, template logic, unscoped style, colour literal or unpaired protocol module"
fi
exit $status
