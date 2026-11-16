#!/usr/bin/env bash
# Codex 적대적 리뷰 실행 도우미 — 변경 체크리스트의 「적대적 리뷰 단계」가 부른다.
#
#   pnpm review:codex <base> [--spec <경로>]... [--dry-run] [초점 문구...]
#   예) pnpm review:codex HEAD~1 --spec .scratch/implied-selection/PRD.md 빌더 저장과 칸 복사 경로를 의심해서 봐줘
#
# 하는 일은 셋이다.
#  1. Codex 플러그인의 companion 스크립트를 찾는다(버전 폴더가 바뀌어도 가장 높은 버전).
#     못 찾으면 CODEX_COMPANION=<codex-companion.mjs 경로> 로 알려 준다.
#  2. 매번 손으로 붙이던 고정 초점 문구를 붙인다 — 체크리스트 경로 · 스펙 경로 · 한국어 출력.
#  3. 테스트를 돌리지 말라고 알린다. 리뷰는 읽기 전용 샌드박스에서 돌아 vitest 가 임시 폴더를
#     만들지 못하고(mkdir EPERM) 수집 전에 죽는다(2026-11-12 두 번). 돌려 보고 싶은 명령은
#     next_steps 에 「실행 요청:」으로 적게 하고, 부른 쪽이 돌려 확인한다.
#
# 오래 걸린다(수 분). 에이전트는 백그라운드로 돌리고 끝나면 출력을 읽는다.
set -euo pipefail

usage() {
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

base=""
dry_run=0
specs=()
focus=()

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage 0 ;;
    --dry-run) dry_run=1 ;;
    --spec)
      [ $# -ge 2 ] || { echo "--spec 뒤에 경로를 적어 주세요" >&2; exit 2; }
      [ -e "$2" ] || { echo "스펙 파일이 없습니다: $2" >&2; exit 2; }
      specs+=("$2")
      shift
      ;;
    *)
      if [ -z "$base" ]; then base="$1"; else focus+=("$1"); fi
      ;;
  esac
  shift
done

[ -n "$base" ] || { echo "기준 커밋(base)을 적어 주세요 — 예: HEAD~1, origin/main" >&2; usage 2; }
git rev-parse --verify --quiet "$base^{commit}" > /dev/null || { echo "기준 커밋을 찾을 수 없습니다: $base" >&2; exit 2; }

companion="${CODEX_COMPANION:-}"
if [ -z "$companion" ]; then
  companion="$(ls -d "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2> /dev/null | sort -V | tail -1 || true)"
fi
[ -n "$companion" ] && [ -f "$companion" ] || {
  echo "Codex 플러그인의 codex-companion.mjs 를 찾지 못했습니다. CODEX_COMPANION=<경로> 로 지정해 주세요." >&2
  exit 2
}

checklist=".agents/skills/write-change-checklist/SKILL.md"
text="$checklist 의 항목별로 실패 시나리오를 찾고, 문제없는 항목도 근거를 적어라."
if [ ${#specs[@]} -gt 0 ]; then
  text="$text 스펙은 ${specs[*]} 이다."
fi
text="$text 테스트·타입 검사 명령(vitest, tsc, pnpm test)은 실행하지 마라 — 이 리뷰는 읽기 전용 샌드박스라 임시 폴더를 만들지 못해 수집 전에 죽는다. 돌려서 확인하고 싶은 것은 next_steps 에 「실행 요청: <명령> — <기대 결과>」 형식으로 적어라. 부른 쪽이 돌린다."
text="$text 리뷰 결과(summary, findings, recommendation, next_steps 전부)는 한국어로 쓴다."
if [ ${#focus[@]} -gt 0 ]; then
  text="$text 특히 볼 곳: ${focus[*]}"
fi

if [ "$dry_run" -eq 1 ]; then
  # %q 는 한글을 바이트로 풀어 읽을 수 없게 찍는다 — 그대로 보인다
  printf '실행할 명령: node %s adversarial-review --base %s <초점 문구>\n초점 문구: %s\n' "$companion" "$base" "$text"
  exit 0
fi

exec node "$companion" adversarial-review --base "$base" "$text"
