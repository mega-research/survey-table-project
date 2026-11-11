#!/usr/bin/env bash
# main 에 푸시한 커밋의 Vercel 배포가 끝날 때까지 기다렸다가 결과를 한 줄로 낸다.
#
# 사용:
#   pnpm deploy:wait            # HEAD
#   pnpm deploy:wait <sha>
#
# main 푸시가 곧 프로덕션 배포다. 푸시 뒤 「배포가 됐는가」를 손으로 폴링하지 않게 한다 —
# 에이전트 세션에서는 sleep 을 이어 붙인 폴링이 막혀 있어 이 스크립트를 백그라운드로 돌린다.
# 성공이면 0, 실패·오류면 1, 20분 안에 안 끝나면 2.
set -euo pipefail
cd "$(dirname "$0")/.."

SHA="$(git rev-parse "${1:-HEAD}")"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
DEADLINE=$(( $(date +%s) + 1200 ))

# 원격에 없는 커밋은 배포될 일이 없다 — 20분을 기다리지 않고 바로 말한다.
git fetch origin main -q
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "${SHA:0:8} 은 origin/main 에 없습니다 — 아직 푸시하지 않은 커밋입니다."
  exit 2
fi

while :; do
  STATE="$(gh api "repos/${REPO}/commits/${SHA}/status" \
    --jq '[.statuses[] | select(.context | test("Vercel"))] | first | .state // "none"' 2>/dev/null || echo none)"
  case "$STATE" in
    success)
      echo "배포 성공 — ${SHA:0:8}"
      exit 0 ;;
    failure|error)
      DESC="$(gh api "repos/${REPO}/commits/${SHA}/status" \
        --jq '[.statuses[] | select(.context | test("Vercel"))] | first | "\(.description) \(.target_url)"')"
      echo "배포 실패 — ${SHA:0:8}: ${DESC}"
      exit 1 ;;
  esac
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "20분이 지나도 배포 상태가 ${STATE} 입니다 — ${SHA:0:8}. Vercel 대시보드를 확인하세요."
    exit 2
  fi
  sleep 15
done
