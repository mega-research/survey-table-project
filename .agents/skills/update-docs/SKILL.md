---
name: update-docs
description: This skill should be used when the user asks to "update documentation for my changes", "check docs for this PR", "what docs need updating", "sync docs with code", "문서 최신화", "문서 갱신", "docs 업데이트", "review docs completeness", "what documentation is affected", or when a change lands that touches package.json, src/server/, src/features/, src/shared/contracts/, src/db/schema/, src/app/ routes, supabase/migrations/, or src/lib/inngest/. Guides updating this repo's agent-facing docs (root AGENTS.md, per-directory AGENTS.md under src/, CONTEXT.md, docs/adr/) from actual code state.
---

# Survey Table Project 문서 최신화

이 레포의 문서를 **코드 실물 대조**로 갱신한다. 문서는 사람이 아니라 에이전트가 매 세션 읽는 참조물이므로, 틀린 사실 하나가 잘못된 작업 경로로 이어진다.

## 문서 지형 — 무엇을 갱신하고 무엇을 두는가

| 문서                             | 성격                                     | 갱신 대상?                                              |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `AGENTS.md` (루트)               | 매 세션 실리는 공통 규칙 + 문서 지도     | **예 — 이 스킬의 주 대상**                              |
| `src/**/AGENTS.md` (영역 문서)   | 영역별 상세 (서버·권한·스키마·라우트 등) | **예** — 목록은 루트 `AGENTS.md` 의 "문서 지도"         |
| `CLAUDE.md` (루트·각 폴더)       | 같은 폴더 `AGENTS.md` 의 심볼릭 링크     | 자동 (직접 편집 금지)                                   |
| `CONTEXT.md`                     | 도메인 언어 사전                         | 예 — 용어가 바뀌거나 미구현 절이 생겼을 때              |
| `docs/adr/`                      | 결정 기록 (불변)                         | **아니오** — 내용 수정 금지. 상태 표기·supersede 표기만 |
| `docs/superpowers/plans`·`specs` | 시점 기록물                              | **아니오** — 최신 코드에 맞추면 기록 가치가 사라짐      |
| `docs/runbooks/`                 | 운영 절차                                | 예 — 절차가 실제로 바뀌었을 때                          |
| `DESIGN.md`                      | 디자인 목표 명세                         | 별도 작업 (코드 SoT 는 `globals.css`)                   |

`CLAUDE.md` 는 같은 폴더의 `AGENTS.md` 를 가리키는 심볼릭 링크다. **항상 `AGENTS.md` 만 편집**한다.

**크기 상한은 `tests/repo/agent-docs-size.test.ts` 가 강제한다** — 루트 4.5만 자, 영역 문서 3만 자(루트는 매 세션 통째로 실리고, Claude Code 는 15만 자를 넘으면 경고한다). 영역 문서가 상한에 닿으면 문장을 줄이기 전에 **더 깊은 폴더로 내릴 수 있는지**를 먼저 본다. 같은 테스트가 영역 문서마다 `CLAUDE.md` 심볼릭 링크와 루트 "문서 지도" 등재를 확인한다. 새 서브시스템의 상세 절은 루트가 아니라 그 코드 옆 영역 문서에 쓰고, 루트에는 "문서 지도" 표에 한 줄만 더한다. 영역 문서를 새로 만들면 같은 폴더에 `ln -s AGENTS.md CLAUDE.md` 를 함께 만든다.

**변경 이력("최종 갱신" 블록)을 쓰지 않는다.** 2026-10-20 에 루트 상단의 갱신 기록 8천 자를 지웠다 — git log 와 ADR 이 그 자리다. `docs/` 는 gitignore 대상이라 ADR·plan·spec 변경은 로컬 전용이다.

## 워크플로

### 1단계: 변경 범위 확보

```bash
git log --oneline -30                  # 최근 작업 흐름
git diff main...HEAD --stat            # 브랜치 작업이면 (기본 브랜치는 main, 통합은 staging 경유)
```

문서가 마지막으로 바뀐 이후를 보려면 `git log -1 --format=%cs -- AGENTS.md 'src/**/AGENTS.md'` 로 날짜를 얻고 `git log --since=<날짜> --oneline | wc -l` 로 규모를 잰다.

### 2단계: 코드 → 문서 대조

`references/CODE-TO-DOCS-MAPPING.md` 의 대조표를 따른다. **문서를 읽고 기억으로 고치지 말고, 대조 명령을 실제로 돌려 나온 출력과 문서를 비교**한다. 이 레포의 문서 드리프트는 대부분 "추가된 것이 문서에 없음" 형태라 diff 만 봐서는 놓친다.

### 3단계: 수정

- 사실 오류(버전·개수·경로·컬럼)는 확인 즉시 고친다.
- 새 서브시스템은 절을 신설한다. 기존 절에 한 줄로 끼워 넣으면 에이전트가 못 찾는다. 자리는 그 코드 옆 영역 문서다(위 "문서 지형").
- **관행이 코드와 어긋난 항목이 최우선**이다. 특히 마이그레이션·테스트·배포 관행은 틀리면 사고로 이어진다.
- 미구현 설계가 문서에 있으면 지우지 말고 `> 구현 상태: **미착수** (날짜 확인 — 근거)` 표기를 단다. 인용 블록 **뒤에는 반드시 빈 줄**을 둔다(없으면 다음 줄이 blockquote 에 흡수된다).

### 4단계: 검증

````bash
DOCS=$(git ls-files 'AGENTS.md' 'src/**/AGENTS.md')
grep -n '^## ' $DOCS                   # 절 구성과 순서
grep -c '^```' $DOCS                   # 코드펜스 짝수 확인
pnpm exec prettier --write $DOCS       # 표 정렬 — 뒤에 grep -n '~~' 로 취소선 변환을 확인
pnpm exec vitest run tests/repo/agent-docs-size.test.ts   # 크기 상한 · CLAUDE.md 링크 · 문서 지도 등재
find . -name CLAUDE.md -path './src/*' -o -name CLAUDE.md -maxdepth 1 | xargs ls -la   # 심볼릭 링크가 살아있는지
````

코드를 함께 만졌다면 `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test` 까지.

### 5단계: 보고

무엇을 어떤 근거로 고쳤는지 열거한다. **확인하지 못한 것은 확인한 척하지 않는다** — "이 부분은 대조하지 못했다"고 남기는 편이 낫다.

## 함정

- **기억으로 쓰지 말 것.** 버전·개수·경로는 전부 명령 출력에서 가져온다.
- **plan/spec 을 최신화하지 말 것.** 요청이 "문서 전부 최신화"여도 시점 기록물은 제외하고, 제외했다고 보고한다.
- **`CLAUDE.md` 직접 편집 금지.** 심볼릭 링크라 `AGENTS.md` 가 바뀐다(같은 파일이지만 의도를 분명히 할 것).
- **`.mdx`·Next.js 본체 규약은 이 레포와 무관하다.** 이 레포의 문서는 전부 순수 마크다운이다.
- **prettier 가 `~` 를 취소선으로 바꾼다.** 한 문단에 `0128~0132` 같은 물결표가 둘 있으면 `~~` 로 짝지어 취소선이 된다. prettier 뒤에 `grep -n '~~'` 로 확인할 것.
- **ADR 번호는 발행 순번**이다. 새 ADR 은 현재 최대 번호 다음을 쓴다(중복 발번 이력 있음 — `0015` 별칭 주석 참조).
