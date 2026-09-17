# 코드 → 문서 대조표

각 행의 **대조 명령을 실제로 실행**하고 그 출력과 문서를 비교한다. 기억이나 diff 만으로 판단하지 않는다.

## AGENTS.md

| 코드                                            | 문서 절                          | 대조 명령                                                                                                                                           |
| ----------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` deps                             | 기술 스택                        | `node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};Object.entries(d).forEach(([k,v])=>console.log(k,v))"` |
| `package.json` scripts                          | 개발 스크립트                    | `node -e "console.log(Object.keys(require('./package.json').scripts).join(' '))"`                                                                   |
| `src/server/*/`                                 | 프로젝트 구조 (서버 도메인 개수·목록) | `ls -d src/server/*/`                                                                                                                          |
| `src/features/*/`                               | 프로젝트 구조 (프론트 기능 묶음·개수) | `for d in src/features/*/; do echo "$(basename $d): $(find $d -name '*.ts*' ! -name '*.test.*' \| wc -l)"; done`                              |
| `src/server/router.ts`                          | 데이터 흐름 아키텍처             | `cat src/server/router.ts`                                                                                                                          |
| `src/server/orpc.ts`                            | 인증과 권한 (베이스 종류)        | `grep -n "^export const" src/server/orpc.ts`                                                                                                        |
| `src/db/schema/*.ts`                            | 데이터베이스 스키마 (컬럼 단위)  | `grep -n "^export const .* = pgTable" src/db/schema/*.ts` + 테이블별 컬럼 추출                                                                      |
| `src/app/**/page.tsx`                           | 운영 콘솔 라우트 / 프로젝트 구조 | `find src/app -name 'page.tsx' \| sed 's\|src/app\|\|; s\|/page.tsx\|\|' \| sort`                                                                   |
| `src/app/api/**/route.ts`                       | API 엔드포인트                   | `find src/app/api -name 'route.ts' \| sort`                                                                                                         |
| `src/lib/*` (디렉터리)                          | 프로젝트 구조 lib 목록           | `ls src/lib`                                                                                                                                        |
| `src/lib/inngest/functions/`                    | 백그라운드 잡 (트리거 포함)      | `cat src/lib/inngest/functions/index.ts` + `grep -n "triggers" src/lib/inngest/functions/*.ts`                                                      |
| `src/stores/`, `src/hooks/`, `src/utils/`       | 프로젝트 구조 (공용 구역 잔류분)  | `ls src/stores src/hooks src/utils` — 기능 전용은 features/<x>/{stores,hooks,queries,utils}                                                        |
| `src/components/*/`                             | 프로젝트 구조 (ui·providers 만)  | `ls src/components` — ui·providers 외가 생기면 features 로 가야 할 것이 아닌지 의심                                                                 |
| `src/types/survey.ts`                           | 질문 유형 / 셀 타입 / 검증 규칙  | `grep -n "QuestionType\|TableValidationType" -A12 src/types/survey.ts`                                                                              |
| `supabase/migrations/*.sql`                     | 주의사항 7 (마이그레이션)        | `ls supabase/migrations \| tail -5` + `manual-migrations.json` 등재 확인                                                                            |
| `vitest.config.ts`                              | 주의사항 (테스트)                | `cat vitest.config.ts`                                                                                                                              |
| `.github/workflows/ci.yml`, `.github/*-gate.ts` | CI 게이트                        | `grep -nE "name:\|run:" .github/workflows/ci.yml`                                                                                                   |
| `process.env` 사용처                            | 환경 변수                        | `grep -rhoE "process\.env\[?['\"]?[A-Z][A-Z0-9_]+" src workers scripts \| sort -u`                                                                  |
| `next.config.ts`                                | 기술 스택 각주 (빌드 우회 등)    | `cat next.config.ts`                                                                                                                                |

## CONTEXT.md

도메인 **용어**가 바뀌었을 때만 손댄다. 새 기능이 새 어휘를 도입했는지(예: "쿼터 셀", "테스트 파티션") 확인하고, 코드에 없는 설계 어휘 절에는 미착수 표기를 단다.

| 신호                | 확인                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| 새 도메인 개념 등장 | `src/shared/contracts/*.ts` 의 새 인터페이스, `src/server/*/domain/`       |
| 문서에만 있는 개념  | 해당 용어의 코드 흔적 grep — 0건이면 미착수 표기                           |

## docs/adr/

**내용 수정 금지.** 다음 두 경우에만 손댄다.

1. 새 결정 → 새 파일 추가 (번호는 현재 최대 + 1)
2. 기존 결정이 대체되거나 미구현으로 확인됨 → 제목 아래 상태 표기 한 줄 추가

미구현 판정은 grep 근거를 남긴다. 예: 팀/워크스페이스 ADR 은 `grep -rl "teamId\|workspaceId" src` 0건.

## 갱신 후 반드시 확인

- `AGENTS.md` 상단 "최종 갱신" 날짜와 요약을 이번 변경에 맞게 수정했는가
- 스테일 표현이 남았는지: `grep -n "N개 도메인\|<옛 버전>" AGENTS.md`
- 새로 넣은 키워드가 실제로 들어갔는지: `grep -c "<키워드>" AGENTS.md`
