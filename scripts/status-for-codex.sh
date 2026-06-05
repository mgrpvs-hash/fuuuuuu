#!/usr/bin/env bash
set -euo pipefail

run_or_skip() {
  local script_name="$1"
  if npm run | rg -n "^[[:space:]]+${script_name}$" >/dev/null 2>&1; then
    npm run "$script_name"
  else
    echo "skip: npm script '$script_name' not found"
  fi
}

run_or_skip check
run_or_skip build
run_or_skip test:instagram
run_or_skip test:storage
run_or_skip test:caption-format
run_or_skip test:assistant

