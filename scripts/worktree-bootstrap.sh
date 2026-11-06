#!/usr/bin/env bash
# 프로젝트 로컬 워크트리를 만들고 바로 일할 수 있게 준비한다.
#
# 사용:
#   pnpm worktree:new <브랜치> [시작점=HEAD]   # .claude/worktrees/<브랜치 이름의 / 를 - 로>
#   pnpm worktree:new <브랜치> --existing      # 이미 있는 브랜치를 체크아웃
# 같은 이름의 워크트리가 이미 있으면 생성은 건너뛰고 링크·설치·검사만 다시 한다.
#
# 하는 일 — 워크트리 준비 규칙의 정본이다(AGENTS.md 「Worktree bootstrap」은 여기를 가리킨다):
#   1. 메인 checkout 의 env 파일을 심볼릭 링크한다. 내용을 읽거나 출력하지 않는다.
#      워크트리에 실제 파일 사본이 있으면(Orca 가 복사한다) 메인과 같을 때만 링크로 바꾼다.
#   2. gitignore 된 공유 자료를 링크한다: .scratch(티켓·PRD) · pencil(시안) · docs 의 미추적 하위
#      (adr·agents·research). docs 는 추적 파일이 섞여 있어 디렉터리째 링크하면 git 이 삭제로 본다.
#   3. node_modules 는 링크하지 않고 `pnpm install --frozen-lockfile` 로 실제 설치한다.
#      링크하면 pnpm 11 의 verify-deps-before-run 이 메인 checkout 의 node_modules 를 퍼지하려 든다.
#   4. 링크가 실제로 풀리는지 확인한다.
# `pnpm build` 는 돌리지 않는다(몇 분 걸린다). 경계를 건드리는 작업이면 완료 보고 전에 한 번 돌릴 것.
set -euo pipefail

MAIN="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
BRANCH="${1:-}"
FROM="${2:-HEAD}"
if [ -z "$BRANCH" ]; then
  echo "사용: pnpm worktree:new <브랜치> [시작점|--existing]" >&2
  exit 2
fi
WT="$MAIN/.claude/worktrees/${BRANCH//\//-}"

cd "$MAIN"
if [ -d "$WT" ]; then
  echo "[1/4] 워크트리 있음 — 생성 건너뜀: $WT"
elif [ "$FROM" = --existing ]; then
  echo "[1/4] 기존 브랜치 ${BRANCH} 체크아웃"
  git worktree add "$WT" "$BRANCH" >/dev/null
else
  echo "[1/4] ${FROM} 에서 브랜치 ${BRANCH} 생성"
  git worktree add -b "$BRANCH" "$WT" "$FROM" >/dev/null
fi
cd "$WT"

# 링크 하나. 대상이 실제 디렉터리면 ln 이 그 안에 링크를 만드는 함정이 있어 먼저 확인한다.
link() {
  local rel="$1" src="$MAIN/$1"
  [ -e "$src" ] || return 0
  if [ -L "$rel" ]; then
    ln -sfn "$src" "$rel"
  elif [ -f "$rel" ]; then
    if cmp -s "$src" "$rel"; then
      rm "$rel" && ln -s "$src" "$rel"
    else
      echo "  경고: ${rel} 이 메인과 다른 실제 파일이라 그대로 둠" >&2
      return 0
    fi
  elif [ -e "$rel" ]; then
    echo "  경고: ${rel} 이 실제 디렉터리라 링크하지 않음" >&2
    return 0
  else
    mkdir -p "$(dirname "$rel")"
    ln -s "$src" "$rel"
  fi
  echo "  링크 ${rel}"
}

echo "[2/4] env·공유 자료 링크"
for f in .env .env.local .env.development .env.development.local .env.production .env.sentry-build-plugin; do
  link "$f"
done
link .scratch
link pencil
for d in docs/adr docs/agents docs/research; do
  if [ -z "$(git ls-files "$d" | head -1)" ]; then link "$d"; fi
done

echo "[3/4] 의존성 설치"
if [ -L node_modules ]; then
  echo "ERROR: node_modules 가 심볼릭 링크입니다. 지우고 다시 실행하세요(rm node_modules)." >&2
  exit 1
fi
pnpm install --frozen-lockfile >/dev/null

echo "[4/4] 확인"
for f in .env .scratch; do
  if [ -e "$MAIN/$f" ] && ! [ -e "$f" ]; then
    echo "ERROR: ${f} 링크가 풀리지 않습니다." >&2
    exit 1
  fi
done
grep -q '^DATABASE_URL=' .env || { echo "ERROR: .env 에 DATABASE_URL 이 없습니다." >&2; exit 1; }
[ -d node_modules/.pnpm ] || { echo "ERROR: node_modules 설치가 비어 있습니다." >&2; exit 1; }
echo "준비 완료: $WT ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))"
