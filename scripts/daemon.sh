#!/usr/bin/env bash
# Kian polling daemon — runs kian poll on an interval and invokes the agent when work exists.
#
# Usage:
#   ./scripts/daemon.sh              # poll every 5 minutes (default)
#   POLL_INTERVAL=60 ./scripts/daemon.sh
#   AGENT_NAME=Kian ./scripts/daemon.sh
#
# Requires the `claude` CLI to be installed and authenticated.
# Stop with Ctrl-C or by killing the process.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KIAN="$REPO_DIR/kian"
INTERVAL="${POLL_INTERVAL:-30}"

if ! command -v claude &>/dev/null; then
  echo "Error: 'claude' CLI not found. Install it with: npm install -g @anthropic-ai/claude-code" >&2
  exit 1
fi

if [ ! -x "$KIAN" ]; then
  echo "Error: kian not found or not executable at $KIAN" >&2
  exit 1
fi

trap 'echo ""; echo "Daemon stopped."; kill 0; exit 0' INT TERM

echo "Kian daemon started — polling every ${INTERVAL}s (press Ctrl-C to stop)"
echo "Project: $REPO_DIR"
echo ""

while true; do
  TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if "$KIAN" poll --quiet 2>/dev/null; then
    echo "[$TIMESTAMP] Work found — invoking agent"
    (cd "$REPO_DIR" && claude --print "check your tasks") 2>&1
    echo "[$TIMESTAMP] Agent run complete (exit $?)"
  else
    echo "[$TIMESTAMP] No tasks — sleeping ${INTERVAL}s"
  fi

  sleep "$INTERVAL"
done
