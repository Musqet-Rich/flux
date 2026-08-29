#!/bin/sh
# Fail if any workspace package.json declares a dependency that is not an exact
# version. engineering.md § Dependencies: "Pin the exact version. No ^, no ~."
# Allowed: exact semver (1.2.3, 1.2.3-beta.1) and workspace:* / workspace:<exact>.
# Checked fields: dependencies, devDependencies, optionalDependencies, peerDependencies.
# Run from the repo root. No dependencies beyond node (24) and POSIX sh.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

files=$(find . -name package.json -not -path '*/node_modules/*' -not -path '*/dist/*' | sort)

# shellcheck disable=SC2086
node --input-type=module -e '
import { readFileSync } from "node:fs";
const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const exact = /^(workspace:(\*|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?)$/;
let bad = 0;
for (const file of process.argv.slice(1)) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  for (const field of fields) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!exact.test(spec)) {
        console.error(`${file}: ${field}.${name} = "${spec}" is not an exact pinned version`);
        bad++;
      }
    }
  }
}
if (bad > 0) {
  console.error(`check-pinned-deps: ${bad} unpinned dependenc${bad === 1 ? "y" : "ies"} (see docs/engineering.md § Dependencies)`);
  process.exit(1);
}
console.log(`check-pinned-deps: all dependencies pinned in ${process.argv.length - 1} package.json file(s)`);
' $files
