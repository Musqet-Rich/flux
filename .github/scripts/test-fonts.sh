#!/bin/sh
# Table test for check-fonts.sh over throwaway files. Run from anywhere; also run by the
# ci.yml "hooks" job. POSIX sh only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-fonts.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail=0
run() {
  expect=$1; name=$2; shift 2
  if "$@" >/dev/null 2>&1; then got=ok; else got=bad; fi
  if [ "$got" = "$expect" ]; then printf '  pass  %-4s %s\n' "$expect" "$name"
  else printf '  FAIL  want %s got %s: %s\n' "$expect" "$got" "$name"; fail=1; fi
}

# Twenty families, `Family N` with a file each, in the shapes the real files have.
ts() {
  {
    echo 'const families: Readonly<Record<Part, readonly string[]>> = {'
    for part in text code; do
      echo "  $part: ["
      i=0
      while [ $i -lt 10 ]; do echo "    'Family $part $i',"; i=$((i + 1)); done
      echo '  ],'
    done
    echo '};'
    echo 'const platform: Readonly<Record<Part, string>> = {'
    echo "  text: \"system-ui, 'Segoe UI', sans-serif\","
    echo "  code: 'ui-monospace, monospace',"
    echo '};'
  } >"$1"
}
css() {
  {
    for part in text code; do
      i=0
      while [ $i -lt 10 ]; do
        echo '@font-face {'
        echo "  font-family: 'Family $part $i';"
        echo '  font-weight: 100 900;'
        echo "  src: url('/fonts/family-$part-$i-var.woff2') format('woff2');"
        echo '  unicode-range: U+0000-00FF;'
        echo '}'
        i=$((i + 1))
      done
    done
  } >"$1"
}
base() {
  {
    echo ':root {'
    echo "  --font-text: system-ui, 'Segoe UI', sans-serif;"
    echo '  --font-code: ui-monospace, monospace;'
    echo '}'
  } >"$1"
}
dir() {
  mkdir -p "$1"
  for part in text code; do
    i=0
    while [ $i -lt 10 ]; do
      : >"$1/family-$part-$i-var.woff2"; : >"$1/family-$part-$i-OFL.txt"; i=$((i + 1))
    done
  done
}

ts "$tmp/fonts.ts"; css "$tmp/fonts.css"; base "$tmp/base.css"; dir "$tmp/fonts"
run ok  'all agree'                                   sh "$check" "$tmp/fonts.ts" "$tmp/fonts.css" "$tmp/base.css" "$tmp/fonts"
run ok  'the repo files agree'                        sh "$check"
sed "s/'Family code 3',/'Family code 10',/" "$tmp/fonts.ts" >"$tmp/ts2"
run bad 'a family listed with no @font-face'          sh "$check" "$tmp/ts2" "$tmp/fonts.css" "$tmp/base.css" "$tmp/fonts"
grep -v "Family text 2'," "$tmp/fonts.ts" >"$tmp/ts3"
run bad 'a family fewer than the twenty'              sh "$check" "$tmp/ts3" "$tmp/fonts.css" "$tmp/base.css" "$tmp/fonts"
sed 's/family-code-4-var/family-code-4-700/' "$tmp/fonts.css" >"$tmp/css2"
run bad 'a file named that is not there'              sh "$check" "$tmp/fonts.ts" "$tmp/css2" "$tmp/base.css" "$tmp/fonts"
sed 's/family-code-4-var/family-code-5-var/' "$tmp/fonts.css" >"$tmp/css4"
run bad "a face pointed at another family's file"     sh "$check" "$tmp/fonts.ts" "$tmp/css4" "$tmp/base.css" "$tmp/fonts"
: >"$tmp/fonts/family-code-4-700.woff2"
awk '/family-code-4-var/ { print "  src: url(\047/fonts/family-code-4-700.woff2\047) format(\047woff2\047);"; next } { print }' "$tmp/fonts.css" >"$tmp/css5"
run bad "a face whose file is another weight's"       sh "$check" "$tmp/fonts.ts" "$tmp/css5" "$tmp/base.css" "$tmp/fonts"
run bad 'a file no face names'                        sh "$check" "$tmp/fonts.ts" "$tmp/fonts.css" "$tmp/base.css" "$tmp/fonts"
rm "$tmp/fonts/family-code-4-700.woff2"
grep -v 'unicode-range' "$tmp/fonts.css" >"$tmp/css6"
run bad 'a face not cut to the Latin block'           sh "$check" "$tmp/fonts.ts" "$tmp/css6" "$tmp/base.css" "$tmp/fonts"
rm "$tmp/fonts/family-text-7-OFL.txt"
run bad 'a file without its licence'                  sh "$check" "$tmp/fonts.ts" "$tmp/fonts.css" "$tmp/base.css" "$tmp/fonts"
: >"$tmp/fonts/family-text-7-OFL.txt"
sed 's/--font-code: ui-monospace, monospace/--font-code: ui-monospace, Menlo, monospace/' "$tmp/base.css" >"$tmp/base2"
run bad 'a platform stack that differs from base.css' sh "$check" "$tmp/fonts.ts" "$tmp/fonts.css" "$tmp/base2" "$tmp/fonts"
{ cat "$tmp/fonts.css"; echo '@font-face {'; echo "  font-family: 'Family text 10';"; echo '  font-weight: 100 900;'; echo "  src: url('/fonts/family-text-10-var.woff2') format('woff2');"; echo '  unicode-range: U+0000-00FF;'; echo '}'; } >"$tmp/css3"
run bad 'a family declared but not offered'           sh "$check" "$tmp/fonts.ts" "$tmp/css3" "$tmp/base.css" "$tmp/fonts"

exit $fail
