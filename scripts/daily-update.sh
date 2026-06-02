#!/usr/bin/env bash
# Daily auto-update: skill repos, OMC, Claude plugins, and the tech stack (bun deps).
# Policy: APPLY ALWAYS — deps are bumped to latest and committed regardless of gate
# results (gates are still run and logged so failures are visible). Commits are scoped
# to auto-update paths only, so unrelated working-tree changes are never swept in.
set -uo pipefail

# Concurrency guard — never run two updates at once (launchd + manual overlap).
LOCK="/tmp/aaelink-daily-update.lock"
if ! mkdir "$LOCK" 2>/dev/null; then echo "daily-update already running; exit"; exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

ROOT="/Users/d7y1ce/AAE/AAELink"
cd "$ROOT"
LOGDIR="$ROOT/.omc/logs"
mkdir -p "$LOGDIR"
STAMP="$(date +%F)"
LOG="$LOGDIR/daily-update-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
echo "================ daily-update $(date) ================"

# ── 1) Skill repos: fresh clone + reinstall to global and project ────────────
TMP="$(mktemp -d)"
clone() { git clone --depth 1 "$2" "$TMP/$1" >/dev/null 2>&1 && echo "  cloned $1" || echo "  FAILED clone $1"; }
clone caveman    https://github.com/JuliusBrussee/caveman
clone mattpocock https://github.com/mattpocock/skills
clone 9arm       https://github.com/thananon/9arm-skills
clone karpathy   https://github.com/multica-ai/andrej-karpathy-skills
echo "-- reinstall skills --"
bash "$ROOT/scripts/install-skills.sh" "$TMP" "$HOME/.claude/skills" || echo "  global install error"
bash "$ROOT/scripts/install-skills.sh" "$TMP" "$ROOT/.claude/skills" || echo "  project install error"
rm -rf "$TMP"

# ── 2) OMC + Claude plugins ──────────────────────────────────────────────────
echo "-- omc update --"
command -v omc >/dev/null && omc update 2>&1 | tail -5 || echo "  omc not on PATH, skipped"
echo "-- claude plugin update --"
command -v claude >/dev/null && claude plugin update --all 2>&1 | tail -5 || echo "  claude plugin update unavailable, skipped"

# ── 3) Tech stack: bun deps to latest (apply always) ─────────────────────────
echo "-- bun update --latest --"
cp package.json "$LOGDIR/package.json.prev" 2>/dev/null || true
cp bun.lock "$LOGDIR/bun.lock.prev" 2>/dev/null || true
bun update --latest 2>&1 | tail -25
bun install 2>&1 | tail -5

# ── 4) Gates (logged, non-blocking) ──────────────────────────────────────────
gate() { echo "-- gate: $1 --"; if eval "$2" >/tmp/gate.out 2>&1; then echo "  PASS $1"; else echo "  FAIL $1"; tail -15 /tmp/gate.out; fi; }
gate type-check "bun run type-check"
gate lint       "bun run lint"
gate test       "bun run test"
gate build      "bun run build"

# ── 5) Commit auto-update paths only (never the rest of the dirty tree) ──────
echo "-- commit --"
git add .claude/skills package.json bun.lock 2>/dev/null
if git diff --cached --quiet; then
  echo "  nothing to commit"
else
  git commit -m "chore: daily auto-update ($STAMP) — skills + deps

Automated by scripts/daily-update.sh. Deps bumped to latest (apply-always policy);
see .omc/logs/daily-update-$STAMP.log for gate results.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" >/dev/null && echo "  committed" || echo "  commit failed"
fi
echo "================ done $(date) ================"
