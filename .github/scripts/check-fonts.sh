#!/bin/sh
# The families Settings offers (apps/pwa/src/appearance/fonts.ts) must each have an @font-face
# in apps/pwa/src/styles/fonts.css, every file the stylesheet names must exist under
# apps/pwa/public/fonts with the family's OFL beside it, and the platform stacks in fonts.ts
# must be the ones base.css paints with (ADR 0030): a family listed with no face falls silently
# to the platform font, a missing file is a 404 only a browser sees, and a stack that differs
# changes the font on every launch with nothing chosen. Run by `pnpm run check`.
#
#   check-fonts.sh                    the repo's files
#   check-fonts.sh TS CSS BASE DIR    given files and a font directory (the test)
#
# No dependencies beyond POSIX sh (awk, sort, comm, mktemp).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
pwa="$here/../../apps/pwa"
ts=${1:-"$pwa/src/appearance/fonts.ts"}
css=${2:-"$pwa/src/styles/fonts.css"}
base=${3:-"$pwa/src/styles/base.css"}
dir=${4:-"$pwa/public/fonts"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

# The families fonts.ts lists: quoted strings inside the `families` object.
awk '
  /^const families/ { on = 1; next }
  on && /^\};/ { on = 0 }
  on && match($0, /^    \047[^\047]+\047,$/) { s = $0; sub(/^    \047/, "", s); sub(/\047,$/, "", s); print s }
' "$ts" | sort >"$tmp/listed"
# The families fonts.css declares; the landing's two are declared too, so the stylesheet may
# have more than the list, never fewer.
awk 'match($0, /^  font-family: \047[^\047]+\047;$/) { s = $0; sub(/^  font-family: \047/, "", s); sub(/\047;$/, "", s); print s }' "$css" | sort -u >"$tmp/declared"
if [ "$(comm -23 "$tmp/listed" "$tmp/declared")" != "" ]; then
  echo "check-fonts: listed in fonts.ts with no @font-face in fonts.css:" >&2
  comm -23 "$tmp/listed" "$tmp/declared" >&2
  fail=1
fi
if [ "$(wc -l <"$tmp/listed" | tr -d ' ')" -ne 20 ]; then
  echo "check-fonts: fonts.ts lists $(wc -l <"$tmp/listed" | tr -d ' ') families; this script expects 20, so update it if one was added" >&2
  fail=1
fi

# Every file named exists, and its family's licence with it (the file's name up to the last
# `-`, then -OFL.txt).
for file in $(awk 'match($0, /url\(\047\/fonts\/[^\047]+\047\)/) { s = substr($0, RSTART + 12, RLENGTH - 14); print s }' "$css"); do
  if [ ! -f "$dir/$file" ]; then echo "check-fonts: fonts.css names $file, not in public/fonts" >&2; fail=1; fi
  licence="${file%-*}-OFL.txt"
  if [ ! -f "$dir/$licence" ]; then echo "check-fonts: $file has no $licence beside it" >&2; fail=1; fi
done

# The platform stacks, verbatim in both.
for part in text code; do
  in_base=$(awk -v p="--font-$part: " 'index($0, p) == 3 { s = $0; sub(/^  --font-[a-z]+: /, "", s); sub(/;$/, "", s); print s }' "$base")
  in_ts=$(awk -v p="  $part: " '
    /^const platform/ { on = 1; next }
    on && /^\};/ { on = 0 }
    on && index($0, p) == 1 { s = $0; sub(/^  [a-z]+: /, "", s); sub(/,$/, "", s); gsub(/^["\047]|["\047]$/, "", s); print s }' "$ts")
  if [ "$in_base" != "$in_ts" ]; then
    echo "check-fonts: the platform $part stack differs: base.css has [$in_base], fonts.ts has [$in_ts]" >&2
    fail=1
  fi
done
exit $fail
