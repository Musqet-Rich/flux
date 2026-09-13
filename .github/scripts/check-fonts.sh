#!/bin/sh
# The families Settings offers (apps/pwa/src/appearance/fonts.ts) must be exactly the ones
# declared in apps/pwa/src/styles/fonts.css; every @font-face must name a file of its own
# family and weight under apps/pwa/public/fonts (the family in kebab case, then -var for a
# weight range or the one weight it declares), with the family's OFL beside it and the one
# unicode-range every face shares, the Latin block the files were cut to; every file in the
# directory must be a face's or the licence of a family with one; and the platform stacks in
# fonts.ts must be the ones base.css paints with (ADR 0030). A
# family listed with no face falls silently to the platform font, a face pointed at another
# family's or weight's file by a slip between twenty alike blocks ships the wrong letters, a
# missing file is a 404 only a browser sees, a file no face names ships for nothing, and a
# stack that differs changes the font on every launch with nothing chosen. Run by
# `pnpm run check`.
#
#   check-fonts.sh                    the repo's files
#   check-fonts.sh TS CSS BASE DIR    given files and a font directory (the test)
#
# No dependencies beyond POSIX sh (awk, sed, sort, comm, cut, tr, wc, ls, mktemp).
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
# "family<TAB>weight<TAB>file<TAB>range" per @font-face in fonts.css: the weight as declared
# (`var` for a range), and the unicode-range with its spaces and line breaks taken out; `-`
# for a field the block lacks, so a slip is named as the block's own and the fields keep
# their places (a tab is whitespace to `read`, and two together would be one).
awk '
  /^@font-face \{/ { f = ""; w = "-"; file = "-"; u = ""; inu = 0 }
  match($0, /^  font-family: \047[^\047]+\047;$/) { f = $0; sub(/^  font-family: \047/, "", f); sub(/\047;$/, "", f) }
  match($0, /^  font-weight: [0-9]+( [0-9]+)?;$/) { w = $0; sub(/^  font-weight: /, "", w); sub(/;$/, "", w); if (w ~ / /) w = "var" }
  /^  unicode-range:/ { inu = 1 }
  inu { r = $0; gsub(/[ \t]/, "", r); sub(/^unicode-range:/, "", r); u = u r; if (r ~ /;$/) { inu = 0; sub(/;$/, "", u) } }
  match($0, /url\(\047\/fonts\/[^\047]+\047\)/) { file = substr($0, RSTART + 12, RLENGTH - 14) }
  /^\}/ && f != "" { print f "\t" w "\t" file "\t" (u == "" ? "-" : u) }
' "$css" >"$tmp/faces"
cut -f1 "$tmp/faces" | sort -u >"$tmp/declared"
if [ "$(comm -3 "$tmp/listed" "$tmp/declared")" != "" ]; then
  echo "check-fonts: the families fonts.ts lists and fonts.css declares differ (< listed, > declared):" >&2
  comm -3 "$tmp/listed" "$tmp/declared" >&2
  fail=1
fi
if [ "$(wc -l <"$tmp/listed" | tr -d ' ')" -ne 20 ]; then
  echo "check-fonts: fonts.ts lists $(wc -l <"$tmp/listed" | tr -d ' ') families; this script expects 20, so update it if one was added" >&2
  fail=1
fi

# Every face names a file of its own family and weight, has the range the first face has (one
# block for all, so a trimmed one stands out), the file exists, and the family's licence is
# beside it.
latin=$(head -n 1 "$tmp/faces" | cut -f4)
while IFS="$(printf '\t')" read -r family weight file range; do
  slug=$(printf '%s' "$family" | tr 'A-Z ' 'a-z-')
  if [ "$file" != "$slug-$weight.woff2" ]; then
    echo "check-fonts: the face for $family at weight $weight names $file, not $slug-$weight.woff2" >&2; fail=1
  fi
  if [ "$range" = "-" ]; then
    echo "check-fonts: the face for $family at weight $weight has no unicode-range" >&2; fail=1
  elif [ "$range" != "$latin" ]; then
    echo "check-fonts: the face for $family at weight $weight has a unicode-range unlike the first face's" >&2; fail=1
  fi
  if [ ! -f "$dir/$file" ]; then echo "check-fonts: fonts.css names $file, not in public/fonts" >&2; fail=1; fi
  if [ ! -f "$dir/$slug-OFL.txt" ]; then echo "check-fonts: $family has no $slug-OFL.txt beside its file" >&2; fail=1; fi
done <"$tmp/faces"

# And nothing else is in the directory: every file is a face's or a licence of a family with
# a face.
{ cut -f3 "$tmp/faces"; cut -f1 "$tmp/faces" | tr 'A-Z ' 'a-z-' | sed 's/$/-OFL.txt/'; } | sort -u >"$tmp/named"
ls "$dir" | sort >"$tmp/present"
if [ "$(comm -13 "$tmp/named" "$tmp/present")" != "" ]; then
  echo "check-fonts: in public/fonts but named by no face in fonts.css:" >&2
  comm -13 "$tmp/named" "$tmp/present" >&2
  fail=1
fi

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
