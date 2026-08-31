#!/bin/sh
# Fail if any line ADDED by a change looks like a secret. engineering.md
# § Security: "Secrets never in the repo". This is the shape check that makes
# that rule tool-enforced; it is not a substitute for rotating a key that was
# ever committed.
#
#   check-secrets.sh --staged        HEAD vs the index (pre-commit hook)
#   check-secrets.sh <base> <head>   two revisions (CI, push and pull_request)
#
# Only added lines of text files are scanned (removing a secret is allowed;
# context lines were already in the tree). Shapes, all case-sensitive unless
# noted: private key PEM headers; AWS access key ids; GitHub, GitLab, npm, Slack,
# Stripe live, Anthropic, OpenAI and Google API tokens; JWTs; a URL with a
# password in its userinfo; and a generic `password|secret|credential|*token|key|api_key = "..."`
# assignment with a 6+ character literal (case-insensitive; the keyword carries the
# signal, so a short literal such as `password: 'hunter2'` still counts); and, whatever the
# name, a quoted literal that is 32+ hex characters, 32+ mixed-case alphanumerics with a
# digit, or 40+ base64 characters with both digits and letters (a raw key or token with no
# telltale prefix). A
# hex test vector is the expected false positive; it carries the marker. A line
# that is a deliberate non-secret (a fixture, a documented example) can carry the marker
# `secrets-allow` anywhere on the line to be skipped, which is visible in review.
# This script's own sources and its test are excluded by path: they contain the
# shapes by necessity. `test/fixtures/` is excluded too (as it is from the
# added-lines gate): fixtures are captured real agent output, never hand-edited
# (engineering.md § Testing), so they may carry high-entropy ids or content
# hashes and cannot take an inline marker without ceasing to be valid captures.
# No dependencies beyond git and POSIX sh (awk, grep).
set -eu

case "${1:-}" in
  --staged)
    [ "$#" -eq 1 ] || { echo "usage: $0 --staged | <base> <head>" >&2; exit 2; }
    base=HEAD
    git rev-parse -q --verify HEAD^{commit} >/dev/null 2>&1 || base=$(git hash-object -t tree /dev/null)
    diff_args="--cached $base"
    ;;
  '')
    echo "usage: $0 --staged | <base> <head>" >&2; exit 2 ;;
  *)
    [ "$#" -eq 2 ] || { echo "usage: $0 --staged | <base> <head>" >&2; exit 2; }
    diff_args="$1 $2"
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

# One ERE per line. Kept as a here-doc so a reviewer can read them; joined with
# `|` below. `[[:space:]]` and `[[:alnum:]]` keep this portable across greps.
patterns=$(cat <<'PATTERNS'
-----BEGIN ([A-Z]+ )?PRIVATE KEY( BLOCK)?-----
(^|[^[:alnum:]])(AKIA|ASIA)[0-9A-Z]{16}([^[:alnum:]]|$)
(^|[^[:alnum:]])gh[pousr]_[A-Za-z0-9]{36,}
(^|[^[:alnum:]])github_pat_[A-Za-z0-9_]{60,}
(^|[^[:alnum:]])glpat-[A-Za-z0-9_-]{20,}
(^|[^[:alnum:]])npm_[A-Za-z0-9]{36}([^[:alnum:]]|$)
(^|[^[:alnum:]])xox[abprs]-[0-9]{10,}-[A-Za-z0-9-]{10,}
(^|[^[:alnum:]])(sk|rk)_live_[A-Za-z0-9]{20,}
(^|[^[:alnum:]])sk-ant-[A-Za-z0-9_-]{32,}
(^|[^[:alnum:]])sk-(proj-)?[A-Za-z0-9_-]{40,}
(^|[^[:alnum:]])AIza[0-9A-Za-z_-]{35}([^[:alnum:]_-]|$)
(^|[^[:alnum:]])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}
[a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]{8,}@
PATTERNS
)
# Keyword forms: a secret-ish word with any suffix (`passwordHash`, `apiKeyV2`), any word ending
# in `token` (`sessionToken`), or a bare `key`/`keys` not glued to a preceding letter (so
# `hotkey`, `cacheKey`, `keyboard` and a Vue `:key="..."` binding stay out; `apiKey` is caught by
# its own form).
kw='(password|passwd|secret|credential|api[_-]?key|access[_-]?key|private[_-]?key|signing[_-]?key)[a-z0-9_]*|[a-z0-9_]*token[s]?|(^|[^a-z:])key[s]?'
generic='('"$kw"')["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{6,}["'"'"']'

regex=$(printf '%s\n' "$patterns" | paste -sd '|' -)

# Added lines only, tagged with their path and new line number so the report is
# actionable. `-U0` gives one hunk per change; the hunk header carries the new
# starting line. Binary files produce no `+` lines under --no-textconv/-U0.
# shellcheck disable=SC2086
added=$(git diff --no-color --no-ext-diff --no-textconv --diff-filter=AM -U0 $diff_args -- . \
  ':(exclude).github/scripts/check-secrets.sh' ':(exclude).github/scripts/test-secrets.sh' \
  ':(exclude,glob)**/test/fixtures/**' \
  | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^@@/ { n = $3; sub(/^\+/, "", n); sub(/,.*/, "", n); line = n + 0; next }
    /^\+/ { printf "%s:%d:%s\n", file, line, substr($0, 2); line++; next }
  ')

if [ -z "$added" ]; then
  echo "check-secrets: no added lines to scan"
  exit 0
fi

hits=$(printf '%s\n' "$added" | grep -v 'secrets-allow' | { grep -E -e "$regex" || true; } )
hits_generic=$(printf '%s\n' "$added" | grep -v 'secrets-allow' | { grep -E -i -e "$generic" || true; } )
# Quoted high-entropy literal: every quoted run of 32+ [A-Za-z0-9+/] (with base64 padding) is
# tried. Pure hex needs 32 and a digit and a letter; a mixed run needs 32 with lower case, upper
# case and a digit all present (a raw token in one case is rarer than a long identifier), or 40
# with a digit and a letter; a long word or a repeated character never counts. `\047` is the
# single quote.
hits_entropy=$(printf '%s\n' "$added" | grep -v 'secrets-allow' | awk '
  {
    text = $0
    while (match(text, /["\047][A-Za-z0-9+\/]{32,}={0,2}["\047]/)) {
      lit = substr(text, RSTART + 1, RLENGTH - 2); sub(/=+$/, "", lit)
      hex = (lit ~ /^[0-9a-fA-F]+$/)
      mixed = (lit ~ /[a-z]/ && lit ~ /[A-Z]/ && lit ~ /[0-9]/)
      if ((hex || mixed || length(lit) >= 40) && lit ~ /[0-9]/ && lit ~ /[A-Za-z]/) { print $0; break }
      text = substr(text, RSTART + RLENGTH - 1)
    }
  }')
all=$(printf '%s\n%s\n%s\n' "$hits" "$hits_generic" "$hits_entropy" | sed '/^$/d' | sort -u)

if [ -n "$all" ]; then
  echo "check-secrets: added lines that look like secrets (docs/engineering.md § Security):" >&2
  # Print path:line and a redacted preview: the first 40 characters of the line.
  printf '%s\n' "$all" | while IFS= read -r hit; do
    loc=$(printf '%s' "$hit" | cut -d: -f1,2)
    text=$(printf '%s' "$hit" | cut -d: -f3- | cut -c1-40)
    printf '  %s: %s...\n' "$loc" "$text" >&2
  done
  echo "check-secrets: if a line is a deliberate non-secret (fixture, example), add the marker secrets-allow to it; if it is real, rotate it, it is compromised the moment it is committed" >&2
  exit 1
fi

count=$(printf '%s\n' "$added" | wc -l | tr -d ' ')
echo "check-secrets: $count added line(s) scanned, no secret shapes"
