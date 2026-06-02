#!/usr/bin/env bash
# Reinstall cloned skill repos into a target .claude/skills dir (idempotent).
# Usage: install-skills.sh <SRC_ROOT> <TARGET_SKILLS_DIR>
#   SRC_ROOT must contain freshly-cloned: caveman/ mattpocock/ 9arm/ karpathy/
set -euo pipefail
SRC="$1"
TARGET="$2"
mkdir -p "$TARGET"

cp_skill() { command rm -rf "$TARGET/$2"; command cp -R "$1" "$TARGET/$2"; }

# names that collide with existing repo/global skills -> prefix mp-
COLLIDE=" caveman diagnose handoff tdd review "

echo "[$TARGET]"

# 1) caveman (canonical source dir)
if [ -d "$SRC/caveman/skills" ]; then
  for d in "$SRC"/caveman/skills/*/; do n=$(basename "$d"); cp_skill "$d" "$n"; done
fi

# 2) karpathy
[ -d "$SRC/karpathy/skills/karpathy-guidelines" ] && cp_skill "$SRC/karpathy/skills/karpathy-guidelines" "karpathy-guidelines"

# 3) 9arm (flatten)
if [ -d "$SRC/9arm/skills" ]; then
  while IFS= read -r f; do d=$(dirname "$f"); n=$(basename "$d"); cp_skill "$d" "$n"; done \
    < <(find "$SRC/9arm/skills" -name SKILL.md)
fi

# 4) mattpocock (all, flatten; collisions -> mp- prefix + rewrite frontmatter name)
if [ -d "$SRC/mattpocock/skills" ]; then
  while IFS= read -r f; do
    d=$(dirname "$f"); n=$(basename "$d"); dest="$n"
    if [[ "$COLLIDE" == *" $n "* ]] || [[ -e "$TARGET/$n" ]]; then dest="mp-$n"; fi
    cp_skill "$d" "$dest"
    if [[ "$dest" == mp-* ]]; then
      perl -i -pe "BEGIN{\$done=0} if(!\$done && /^name:\s*/){s/^name:\s*.*/name: $dest/; \$done=1}" "$TARGET/$dest/SKILL.md"
    fi
  done < <(find "$SRC/mattpocock/skills" -name SKILL.md)
fi

echo "  skill dirs now: $(find "$TARGET" -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"
