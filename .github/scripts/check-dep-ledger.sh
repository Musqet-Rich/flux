#!/bin/sh
# Fail if a dependency was added or re-pinned in any package.json without a line
# in the dependency ledger. engineering.md § Dependencies step 2 and Definition of
# done 3: every package change has a line in docs/adr/0010-dependencies.md.
#
#   check-dep-ledger.sh --staged        HEAD vs the index (pre-commit hook)
#   check-dep-ledger.sh <base> <head>   two revisions (CI, push and pull_request)
#
# For every package.json that changed between the two trees, each entry of
# dependencies / devDependencies / optionalDependencies / peerDependencies that
# is new or has a different spec must appear as `name` (backticked) in the ledger
# as it stands on the NEW side. So a ledger line added in the same change
# satisfies it, an already-ledgered package may be re-pinned freely, and a
# removed dependency needs nothing. A package FIRST ledgered in the change must
# sit in a table row with every cell filled (`notes` excepted) and, where the
# `version` column carries the pinned spec from package.json rather than a
# placeholder; the table must have `version`, `downloads`, `maintainer`, `licence`
# and `transitive` columns, the downloads and transitive cells must hold a
# number, maintainer and licence cells a name, no cell may be a placeholder
# (tbd, x, n/a, ...) and the `why` cell must run to at least 8 words (or point
# at an ADR, `See 0011`): what the package does and why the platform or 50
# lines of our own code cannot (engineering.md § Dependencies step 2). Whether the argument holds is review. `workspace:` specs are internal packages,
# not npm dependencies, and are skipped. Likewise every package newly listed in
# pnpm-workspace.yaml `onlyBuiltDependencies` (the lifecycle-script allow-list,
# engineering.md § Dependencies step 4) must be named in the ledger with its
# reason. Run from anywhere inside the repo. No dependencies beyond git, node
# (24) and POSIX sh.
set -eu

ledger=docs/adr/0010-dependencies.md

case "${1:-}" in
  --staged)
    [ "$#" -eq 1 ] || { echo "usage: $0 --staged | <base> <head>" >&2; exit 2; }
    base=HEAD
    head=
    # A repository with no commit yet: everything staged is new.
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

# shellcheck disable=SC2086
changed=$(git diff --name-only --diff-filter=AM $diff_args -- 'package.json' '*/package.json' | grep -v '/node_modules/' || true)
# shellcheck disable=SC2086
workspace=$(git diff --name-only --diff-filter=AM $diff_args -- pnpm-workspace.yaml || true)

if [ -z "$changed" ] && [ -z "$workspace" ]; then
  echo "check-dep-ledger: no package.json or pnpm-workspace.yaml changed"
  exit 0
fi

# $head empty means "the index": git's `:<path>` syntax.
node --input-type=module -e '
import { execFileSync } from "node:child_process";
const [base, head, ledgerPath, workspace, ...files] = process.argv.slice(1);
const show = (rev, path) => {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const deps = (text) => {
  const out = new Map();
  if (!text) return out;
  const pkg = JSON.parse(text);
  for (const field of fields) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) continue;
      out.set(`${field}.${name}`, { name, spec });
    }
  }
  return out;
};
const ledger = show(head, ledgerPath);
const ledgerBefore = show(base, ledgerPath);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ledgered = (name) => new RegExp("`" + escape(name) + "`").test(ledger);
// A package first ledgered in this change must sit in a table row whose cells are filled in
// (engineering.md § Dependencies step 2: package, version, what it does, why not the platform,
// downloads, maintainer, licence, transitive count). Every column except `notes` is required,
// and a `version` column must carry the spec pinned in package.json, not a placeholder. Rows
// that were already in the ledger are not re-judged (a re-pin of a ledgered package is free).
// A cell that is filled in but says nothing: tbd/todo/tba/n/a, a lone letter or mark, "at add".
const placeholder = /^`?(tbd|todo|tba|n\/a|none|unknown|x+|\?+|-+|pin at add|at add|pending|later|see above)`?$/i;
// The `why` cell must argue (what it does AND why not the platform); a couple of words cannot.
// A pointer to an ADR that holds the argument (`See 0011`) is accepted at any length.
const minWhyWords = 8;
const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const rowProblems = (name, spec) => {
  if (new RegExp("`" + escape(name) + "`").test(ledgerBefore)) return [];
  const lines = ledger.split("\n");
  const re = new RegExp("`" + escape(name) + "`");
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]) || !/^\s*\|/.test(lines[i])) continue;
    let h = i;
    while (h > 0 && /^\s*\|/.test(lines[h - 1])) h--;
    // A table is a header row, a `| --- |` separator, then rows; a lone `|` line after prose is not one.
    if (h === i || !/^\s*\|[\s|:-]*\|\s*$/.test(lines[h + 1] ?? "")) continue;
    const header = cells(lines[h]).map((c) => c.toLowerCase());
    const row = cells(lines[i]);
    const problems = [];
    // The table itself must carry every step-2 field as a column; a table that lacks one can
    // never demand it of a row, so the row is judged incomplete however full its cells are.
    for (const need of ["version", "downloads", "maintainer", "licence", "transitive"]) {
      if (!header.some((col) => col.includes(need))) problems.push(`table has no \`${need}\` column`);
    }
    header.forEach((col, k) => {
      const v = row[k] ?? "";
      if (col === "notes") return;
      if (!v) problems.push(`empty \`${col}\` cell`);
      else if (placeholder.test(v)) problems.push(`\`${col}\` is the placeholder "${v}"`);
      else if (col === "version" && v !== spec && v !== "`" + spec + "`") problems.push(`\`version\` is "${v}", package.json pins ${spec}`);
      else if ((col.includes("downloads") || col.includes("transitive")) && !/[0-9]/.test(v)) problems.push(`\`${col}\` is "${v}", a number is expected`);
      else if ((col.includes("maintainer") || col.includes("licence") || col.includes("license")) && !/[A-Za-z]/.test(v)) problems.push(`\`${col}\` is "${v}", a name is expected`);
      else if (col.includes("why") && v.split(/\s+/).length < minWhyWords && !/(^|[^0-9])0[0-9]{3}([^0-9]|$)/.test(v)) problems.push(`\`${col}\` is "${v}", ${minWhyWords}+ words are expected: what it does and why the platform or 50 lines of our own cannot`);
    });
    if (problems.length === 0) return [];
    if (!best || problems.length < best.length) best = problems;
  }
  return best ?? ["named in prose only; add a table row (package, version, why, downloads, maintainer, licence, transitive deps)"];
};
// `onlyBuiltDependencies` in pnpm-workspace.yaml: an inline `[a, b]` list or `- a` items on
// the following lines. Anything else under that key is a shape this check does not know, so
// it fails closed rather than letting an allow-listed build script through unledgered.
const builtDeps = (text) => {
  const out = new Set();
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^onlyBuiltDependencies:/.test(l));
  if (at < 0) return out;
  const rest = lines[at].replace(/^onlyBuiltDependencies:/, "").replace(/#.*/, "").trim();
  const add = (s) => { const n = s.trim().replace(/^["\u0027]|["\u0027]$/g, ""); if (n) out.add(n); };
  if (rest.startsWith("[")) {
    if (!rest.endsWith("]")) throw new Error("onlyBuiltDependencies: unreadable inline list");
    rest.slice(1, -1).split(",").forEach(add);
    return out;
  }
  if (rest) throw new Error("onlyBuiltDependencies: unreadable value");
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#|$)/.test(l)) continue;
    const m = /^\s+-\s*(.+)$/.exec(l);
    if (!m) break;
    add(m[1].replace(/\s#.*/, ""));
  }
  return out;
};
let bad = 0;
let seen = 0;
if (workspace) {
  let before, after;
  try {
    before = builtDeps(show(base, workspace));
    after = builtDeps(show(head, workspace));
  } catch (e) {
    console.error(`${workspace}: ${e.message}`);
    bad++;
    after = new Set();
  }
  for (const name of after) {
    if (before.has(name)) continue;
    seen++;
    if (ledgered(name)) continue;
    console.error(`${workspace}: onlyBuiltDependencies gained ${name} but \`${name}\` is not in ${ledgerPath} (a lifecycle script is allow-listed only with a reason there)`);
    bad++;
  }
}
for (const file of files) {
  const before = deps(show(base, file));
  const after = deps(show(head, file));
  for (const [key, { name, spec }] of after) {
    const prev = before.get(key);
    if (prev && prev.spec === spec) continue;
    seen++;
    const what = prev ? `changed ${prev.spec} -> ${spec}` : `added ${spec}`;
    if (!ledgered(name)) {
      console.error(`${file}: ${key} ${what} but \`${name}\` is not in ${ledgerPath}`);
      bad++;
      continue;
    }
    const problems = rowProblems(name, spec);
    if (problems.length > 0) {
      console.error(`${file}: ${key} ${what}; the ${ledgerPath} row for \`${name}\` is incomplete: ${problems.join(", ")}`);
      bad++;
    }
  }
}
if (!ledger) {
  console.error(`check-dep-ledger: ${ledgerPath} is missing`);
  bad++;
}
if (bad > 0) {
  console.error(`check-dep-ledger: ${bad} dependency change(s) without a complete ledger line (docs/engineering.md § Dependencies)`);
  process.exit(1);
}
console.log(`check-dep-ledger: ${seen} dependency change(s) in ${files.length} package.json file(s)${workspace ? " and pnpm-workspace.yaml" : ""}, all in ${ledgerPath}`);
' "$base" "$head" "$ledger" "$workspace" $changed
