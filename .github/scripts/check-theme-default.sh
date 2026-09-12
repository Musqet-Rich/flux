#!/bin/sh
# The default theme in apps/pwa/src/appearance/theme.ts must be exactly the tokens in
# apps/pwa/src/styles/base.css (ADR 0030): the stylesheet paints the first frame and the theme
# is set on the root right after, so a value that differs re-colours every device on every
# launch and no test can see it (a `?raw` import of the stylesheet is empty under Vitest, and
# browser code may not read a file). Both files are read here, once, and every
# `--name: light-dark(light, dark)` in the stylesheet's `:root` block must have the same pair
# in the theme, and the theme no pair the stylesheet lacks; the theme's ANSI lists must be the
# two sides of its pair list, since css() reads the lists. Run by `pnpm run check`.
#
#   check-theme-default.sh            the repo's files
#   check-theme-default.sh CSS TS     two given files (the test)
#
# No dependencies beyond POSIX sh (awk, sort, diff, mktemp).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
css=${1:-"$here/../../apps/pwa/src/styles/base.css"}
ts=${2:-"$here/../../apps/pwa/src/appearance/theme.ts"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# "name light dark" per token, from the stylesheet's :root block.
from_css=$(awk '
  /^:root \{/ { root = 1; next }
  root && /^\}/ { root = 0 }
  root && match($0, /^[ \t]*--[a-z0-9-]+:[ \t]*light-dark\(#[0-9a-fA-F]+,[ \t]*#[0-9a-fA-F]+\)/) {
    s = substr($0, RSTART, RLENGTH)
    gsub(/[ \t]/, "", s); sub(/^--/, "", s); sub(/:light-dark\(/, " ", s); sub(/,/, " ", s); sub(/\)$/, "", s)
    print s
  }' "$css" | sort)

# The same from the theme: the ANSI pairs in order, then each side's tokens; and each side's
# `ansi:` must be its side of the pairs, verbatim.
from_ts=$(awk '
  /^const defaultAnsi/ { ansi = 1; n = 0; next }
  ansi && match($0, /\[.#[0-9a-fA-F]+., .#[0-9a-fA-F]+.\]/) {
    s = substr($0, RSTART + 1, RLENGTH - 2); gsub(/[\047" ]/, "", s); sub(/,/, " ", s)
    print "ansi-" n " " s; n++; next
  }
  ansi && /^\];/ { ansi = 0; next }
  /^const defaultTheme/ { theme = 1; next }
  theme && /^  light: \{/ { side = "light"; next }
  theme && /^  dark: \{/ { side = "dark"; next }
  theme && side != "" && match($0, /^    \047?[a-z0-9-]+\047?: \047#[0-9a-fA-F]+\047,/) {
    s = substr($0, RSTART, RLENGTH); gsub(/[\047 ,]/, "", s); split(s, kv, ":")
    if (side == "light") light[kv[1]] = kv[2]; else dark[kv[1]] = kv[2]
    next
  }
  theme && side == "light" && /^    ansi: defaultAnsi\.map\(\(\[light\]\) => light\),$/ { lightAnsi = 1 }
  theme && side == "dark" && /^    ansi: defaultAnsi\.map\(\(\[, dark\]\) => dark\),$/ { darkAnsi = 1 }
  theme && /^\};/ { theme = 0 }
  END {
    for (k in light) print k " " light[k] " " dark[k]
    if (!lightAnsi) print "light.ansi is not the light side of defaultAnsi"
    if (!darkAnsi) print "dark.ansi is not the dark side of defaultAnsi"
  }' "$ts" | sort)

if [ "$from_css" != "$from_ts" ]; then
  echo "check-theme-default: the default theme in theme.ts differs from base.css:" >&2
  printf '%s\n' "$from_css" >"$tmp/css"
  printf '%s\n' "$from_ts" >"$tmp/ts"
  diff "$tmp/css" "$tmp/ts" >&2 || true
  echo "  (< base.css, > theme.ts; a token, its light value, its dark value)" >&2
  exit 1
fi
count=$(printf '%s\n' "$from_css" | wc -l | tr -d ' ')
if [ "$count" -ne 27 ]; then
  echo "check-theme-default: both files list $count tokens; this script expects 11 colours and 16 ANSI (27), so update it if a token was added" >&2
  exit 1
fi
