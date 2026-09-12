#!/bin/sh
# Table test for check-theme-default.sh over throwaway files. Run from anywhere; also run by
# the ci.yml "hooks" job. POSIX sh only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-theme-default.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail=0
run() {
  expect=$1; name=$2; shift 2
  if "$@" >/dev/null 2>&1; then got=ok; else got=bad; fi
  if [ "$got" = "$expect" ]; then printf '  pass  %-4s %s\n' "$expect" "$name"
  else printf '  FAIL  want %s got %s: %s\n' "$expect" "$got" "$name"; fail=1; fi
}

# A stylesheet and a theme that agree, in the shapes the real files have.
css() {
  {
    echo ':root {'
    for t in bg fg muted panel panel-2 border accent accent-fg danger ok warn; do
      echo "  --$t: light-dark(#111111, #eeeeee);"
    done
    i=0
    while [ $i -lt 16 ]; do echo "  --ansi-$i: light-dark(#a0000$((i % 10)), #b0000$((i % 10)));"; i=$((i + 1)); done
    echo '  --radius: 10px;'
    echo '}'
  } >"$1"
}
ts() {
  {
    echo 'const defaultAnsi: readonly (readonly [light: string, dark: string])[] = ['
    i=0
    while [ $i -lt 16 ]; do echo "  ['#a0000$((i % 10))', '#b0000$((i % 10))'],"; i=$((i + 1)); done
    echo '];'
    echo 'const defaultTheme: FullTheme = {'
    echo "  name: 'Default',"
    for side in light dark; do
      [ "$side" = light ] && v='#111111' || v='#eeeeee'
      echo "  $side: {"
      for t in bg fg muted panel panel-2 border accent accent-fg danger ok warn; do
        case $t in *-*) echo "    '$t': '$v',";; *) echo "    $t: '$v',";; esac
      done
      [ "$side" = light ] && echo "    ansi: defaultAnsi.map(([light]) => light)," || echo "    ansi: defaultAnsi.map(([, dark]) => dark),"
      echo '  },'
    done
    echo '};'
  } >"$1"
}

css "$tmp/base.css"; ts "$tmp/theme.ts"
run ok  'the two agree'                                      sh "$check" "$tmp/base.css" "$tmp/theme.ts"
run ok  'the repo files agree'                               sh "$check"
sed 's/--accent: light-dark(#111111/--accent: light-dark(#121212/' "$tmp/base.css" >"$tmp/css2"
run bad 'a light value differs'                              sh "$check" "$tmp/css2" "$tmp/theme.ts"
sed "s/'#b00003'/'#b00004'/" "$tmp/theme.ts" >"$tmp/ts2"
run bad 'an ANSI dark value differs'                         sh "$check" "$tmp/base.css" "$tmp/ts2"
grep -v -- '--warn:' "$tmp/base.css" >"$tmp/css3"
run bad 'a token missing from the stylesheet'                sh "$check" "$tmp/css3" "$tmp/theme.ts"
sed "s/    warn: '#eeeeee',//" "$tmp/theme.ts" >"$tmp/ts3"
run bad 'a token missing from the theme'                     sh "$check" "$tmp/base.css" "$tmp/ts3"
sed 's/ansi: defaultAnsi.map((\[light\]) => light)/ansi: defaultAnsi.map(([, dark]) => dark)/' "$tmp/theme.ts" >"$tmp/ts4"
run bad 'the light ANSI list taken from the dark side'       sh "$check" "$tmp/base.css" "$tmp/ts4"
{ grep -v -- '--accent:' "$tmp/base.css"; echo 'body { --accent: light-dark(#111111, #eeeeee); }'; } >"$tmp/css4"
run bad 'a token declared outside :root'                     sh "$check" "$tmp/css4" "$tmp/theme.ts"

exit $fail
