#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
python3 -m venv .venv || true
source .venv/bin/activate
pip install -r scripts/requirements-prebuild.txt
python scripts/generate_metadata.py --images ./images "$@"
