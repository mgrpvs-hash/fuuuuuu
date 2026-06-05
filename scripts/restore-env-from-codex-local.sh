#!/usr/bin/env bash
set -euo pipefail

SRC=".secrets/codex.env.local"
DST=".env"

if [[ -f "$SRC" ]]; then
  cp "$SRC" "$DST"
  chmod 600 "$DST"
  echo ".env restored"
else
  echo ".env missing"
  exit 1
fi

