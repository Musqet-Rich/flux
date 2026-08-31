#!/bin/sh
# Table test for check-secrets.sh in a throwaway git repository. Sample secrets
# are assembled at run time from fragments so nothing in this file (or the
# repository) is itself a secret-shaped literal. Run from anywhere; also run by
# the ci.yml "hooks" job. POSIX sh and git only.
set -u
here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-secrets.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cd "$tmp"
git init -q -b main .
git config user.email test@example.invalid
git config user.name test
git config commit.gpgsign false
mkdir -p .github/scripts src
# The exclusions are by path, so put stand-ins for the scanner and its test in
# the throwaway repo to prove they are skipped even when they contain shapes.
printf '# scanner\n' >.github/scripts/check-secrets.sh
printf '# test\n' >.github/scripts/test-secrets.sh
printf 'export const x = 1;\n' >src/a.ts
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
rep() { awk -v c="$1" -v n="$2" 'BEGIN { while (n-- > 0) printf "%s", c }'; }

run ok  'nothing staged'

printf 'export const y = 2;\n' >>src/a.ts
run ok  'ordinary code'

printf 'const key = process.env.API_KEY;\n' >>src/a.ts
run ok  'reading a secret from the environment is fine'

printf 'apiKey: "%s"\n' "$(rep a 5)" >>src/a.ts
run ok  'short quoted value under a secret-ish name (under 6 chars)'

printf 'apiKey: "%s"\n' short1 >>src/a.ts
run bad 'generic: 6-char literal is the threshold'

printf 'export const s = { password: "%s" };\n' hunter2 >>src/a.ts
run bad 'generic: password with a 7-char literal'

printf 'export const s = { token: "%s" };\n' abcdef123456789 >>src/a.ts
run bad 'generic: bare token keyword'

printf 'const sessionToken = "%s";\n' "$(rep t 10)" >>src/a.ts
run bad 'generic: a word ending in token'

printf 'const key = "%s";\n' "$(rep k 12)" >>src/a.ts
run bad 'generic: bare key keyword'

printf 'const credentials = "%s";\n' "$(rep c 12)" >>src/a.ts
run bad 'generic: credential keyword'

printf 'const hotkey = "%s"; const cacheKey = "%s";\n' ctrl+shift+s user-list >>src/a.ts
run ok  'hotkey / cacheKey are not the key keyword'

printf 'if (event.key === "%s") close();\n' Escape >>src/a.ts
run ok  'key compared, not assigned'

printf '<li v-for="item in items" :key="item.id">{{ item.name }}</li>\n' >src/List.vue
run ok  'a Vue :key binding is not the key keyword'

printf "export const s = { password: '%s' };\n" hunter2short >>src/a.ts
run bad 'generic: password with a 12-char literal (keyword carries the signal)'

printf 'const apiKey = "%s";\n' "$(rep Q 24)" >>src/a.ts
run bad 'generic: apiKey = "<24 chars>"'

printf 'PASSWORD="%s"\n' "$(rep z 20)" >>src/a.ts
run bad 'generic: PASSWORD="..." (case-insensitive)'

printf 'const apiKey = "%s"; // fixture, secrets-allow\n' "$(rep Q 24)" >>src/a.ts
run ok  'marker secrets-allow skips the line'

printf -- '-----BEGIN %s PRIVATE KEY-----\n' RSA >src/key.pem
run bad 'PEM private key header'

printf -- '-----BEGIN CERTIFICATE-----\n' >src/cert.pem
run ok  'PEM certificate is not a private key'

printf 'aws = %s%s\n' AKIA "$(rep A 16)" >>src/a.ts
run bad 'AWS access key id'

printf 'aws = %s%s\n' AKIA "$(rep A 15)" >>src/a.ts
run ok  'AKIA prefix with the wrong length'

printf 'token = %s_%s\n' ghp "$(rep b 36)" >>src/a.ts
run bad 'GitHub token'

printf 'token = %s_%s\n' github_pat "$(rep b 60)" >>src/a.ts
run bad 'GitHub fine-grained token'

printf 'token = %s_%s\n' npm "$(rep c 36)" >>src/a.ts
run bad 'npm token'

printf 'hook = %s-%s-%s\n' xoxb "$(rep 1 12)" "$(rep d 24)" >>src/a.ts
run bad 'Slack token'

printf 'stripe = %s_live_%s\n' sk "$(rep e 24)" >>src/a.ts
run bad 'Stripe live key'

printf 'stripe = %s_test_%s\n' sk "$(rep e 24)" >>src/a.ts
run ok  'Stripe test key is not flagged'

printf 'k = %s-%s-%s\n' sk ant "$(rep f 40)" >>src/a.ts
run bad 'Anthropic key'

printf 'k = %s-%s\n' sk "$(rep g 48)" >>src/a.ts
run bad 'OpenAI-style key'

printf 'g = %s%s\n' AIza "$(rep h 35)" >>src/a.ts
run bad 'Google API key'

printf 'jwt = %s%s.%s%s.%s\n' eyJ "$(rep i 20)" eyJ "$(rep j 20)" "$(rep k 20)" >>src/a.ts
run bad 'JWT'

printf 'url = "postgres://flux:%s@db.example/flux"\n' "$(rep p 12)" >>src/a.ts
run bad 'URL with password in userinfo'

printf 'url = "wss://relay.example/room"\n' >>src/a.ts
run ok  'URL without userinfo'

printf 'export const sha = "sha512-%s";\n' "$(rep m 86)" >>src/a.ts
run ok  'integrity hash is not a secret shape'

printf "export const hexToken = '%s%s';\n" "$(rep a3f9 6)" "$(rep c2e8d7b6 3)" >>src/a.ts
run bad 'quoted 48-char hex literal with no keyword'

printf "export const h32 = '%s';\n" "$(rep 1f 16)" >>src/a.ts
run bad 'quoted 32-char hex literal'

printf "export const h31 = '%s';\n" "$(rep 1f 15)f" >>src/a.ts
run ok  'quoted 31-char hex literal is under the threshold'

printf 'export const b64 = "%s%s";\n' "$(rep Zm9v 8)" "QUJDMTIz==" >>src/a.ts
run bad 'quoted 40+ base64 literal with digits and letters'

printf 'export const b64short = "%s";\n' "$(rep zm9v 9)" >>src/a.ts
run ok  'quoted 36-char single-case alphanumeric literal is under the threshold'

printf 'export const mixed = "%s";\n' aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW >>src/a.ts
run bad 'quoted 32-char mixed-case alphanumeric literal with no keyword'

printf 'export const mixed31 = "%s";\n' aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1v >>src/a.ts
run ok  'quoted 31-char mixed-case literal is under the threshold'

printf 'export const camel = "%s";\n' "$(rep abcdefghijklmnop 2)"Q >>src/a.ts
run ok  'a 33-char mixed-case literal with no digit is a word'

printf "export const word = '%s';\n" "$(rep abcdefghij 5)" >>src/a.ts
run ok  'a long quoted word without digits is not a token'

printf "export const filler = '%s';\n" "$(rep 0 64)" >>src/a.ts
run ok  'a repeated digit is not a token'

printf "const vector = '%s'; // RFC test vector, secrets-allow\n" "$(rep 0a 32)" >>src/a.ts
run ok  'hex test vector with the marker'

printf 'aws = %s%s\n' AKIA "$(rep A 16)" >>.github/scripts/check-secrets.sh
run ok  'the scanner itself is excluded by path'

printf 'aws = %s%s\n' AKIA "$(rep A 16)" >>.github/scripts/test-secrets.sh
run ok  'the test file is excluded by path'

mkdir -p apps/daemon/test/fixtures
printf '{"snapshot":"%s"}\n' "$(rep 0a 20)" >>apps/daemon/test/fixtures/capture.jsonl
run ok  'captured fixtures are excluded by path'

printf 'aws = %s%s\n' AKIA "$(rep A 16)" >>src/a.ts
git add -A && git commit -qm 'chore(repo): leak' --no-verify
printf 'clean\n' >>src/a.ts
git add -A && git commit -qm 'chore(repo): clean' --no-verify
if sh "$check" HEAD~2 HEAD~1 >/dev/null 2>&1; then got=ok; else got=bad; fi
if [ "$got" = bad ]; then echo '  pass  bad  range mode: base..head catches the leak'
else echo '  FAIL  want bad got ok: range mode'; fail=1; fi
if sh "$check" HEAD~1 HEAD >/dev/null 2>&1; then got=ok; else got=bad; fi
if [ "$got" = ok ]; then echo '  pass  ok   range mode: later clean range is fine'
else echo '  FAIL  want ok got bad: range mode clean'; fail=1; fi
sed -i.bak '/AKIA/d' src/a.ts && rm -f src/a.ts.bak
git add -A
if sh "$check" --staged >/dev/null 2>&1; then echo '  pass  ok   removing a secret is allowed'
else echo '  FAIL  want ok got bad: removal'; fail=1; fi
git reset -q --hard HEAD
if sh "$check" >/dev/null 2>&1; then echo '  FAIL  want bad got ok: usage'; fail=1
else echo '  pass  bad  usage: no arguments'; fi

if [ "$fail" -ne 0 ]; then echo "test-secrets: FAILED" >&2; exit 1; fi
echo "test-secrets: all cases behaved as expected"
