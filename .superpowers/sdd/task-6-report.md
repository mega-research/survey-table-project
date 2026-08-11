# Task 6 Report: append 모드 realdb 테스트 보강

## Status: DONE

## 요약

`tests/integration/contact-upload-modes.realdb.test.ts` 의 기존 describe 블록(`ingestContactUpload 모드별 실 DB 왕복`)에 브리프의 4개 테스트를 verbatim 추가했다.

1. `append: 기존 명단을 유지한 채 신규 행을 이어서 발번한다`
2. `append: 중복 검사 시 duplicatePolicy=skip 은 기존 키 일치 행을 제외한다`
3. `append: duplicatePolicy=insert 는 중복 행도 신규로 추가한다`
4. `merge: 기존 스킴 pii 컬럼은 위저드 piiMapping 미지정이어도 contact_pii 로 라우팅된다`

## 변경 내역

### 테스트 파일 (`tests/integration/contact-upload-modes.realdb.test.ts`)

- import 상단에 `and`(drizzle-orm), `contactPii as contactPiiTable`(`@/db/schema`) 를 병합.
  - 브리프는 `contactPiiTable` 이라는 이름을 썼지만 실제 barrel export 이름은 `contactPii` 이므로 `contactPii as contactPiiTable` 별칭 import 로 처리. 브리프가 사전에 "brief 4번째 테스트는 contactPiiTable(contactPii) 병합 필요"라고 명시한 내용대로 처리한 것이라 왜곡이 아님.
- 4개 `it` 블록을 기존 3개 테스트 뒤, `describe` 닫는 `});` 앞에 브리프 코드 그대로 추가. 로직/assert 수정 없음.

### 구현 코드

**무변경.** Task 5 구현(`src/features/contacts/server/services/contact-uploads.service.ts`, `src/lib/contacts/scheme-helpers.ts`)을 읽고 다음을 확인:
- append 분기(`mode !== 'merge'` 공통 경로에서 `mode === 'append'` 이고 `mergeKeys` 가 있으면 기존 명단과 매칭해 `duplicatePolicy` 적용)가 브리프 요구대로 구현되어 있음.
- `resolveEffectiveRouting` 이 merge/append 모드에서 기존 컬럼 스킴(`pii.<key>`)을 위저드 `piiMapping` 보다 우선시켜, 스킴에 이미 PII 로 등록된 컬럼은 2차 업로드에서 `piiMapping` 미지정이어도 `contact_pii` 로 계속 라우팅됨을 확인.

4개 테스트 모두 최초 실행에서 GREEN — 구현 수정 불필요.

## 검증

### 테스트 실행 (로컬 DB)

```
RUN_REALDB=1 DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  pnpm vitest run tests/integration/contact-upload-modes.realdb.test.ts --reporter=verbose
```

결과: **Test Files 1 passed (1) / Tests 7 passed (7)**. verbose 리포터로 7개 테스트명을 개별 `✓` 로 확인 — 스킵 없이 전부 실제 실행됨.

주의: 브리프가 예시로 준 `DATABASE_URL=... pnpm vitest run <path>` 만으로는 `vitest.config.ts` 의 `RUN_REALDB` 게이트를 통과하지 못해 최초 시도에서 "No test files found" 로 끝났다. `RUN_REALDB=1` 을 추가해 재실행하니 정상 통과. (`pnpm test:integration` 스크립트가 두 env 를 모두 설정하므로 이 스크립트 사용을 권장.)

### tsc

```
npx tsc --noEmit
```

결과: 에러 0.

## Self-Review

- 4번째 테스트가 "2차 업로드에 piiMapping 없음 + attrs 에 평문 부재 + contact_pii 행 존재" 를 검증하는가: 예.
  - 2차 `mapping()` 호출에 `piiMapping` override 자체가 없음 — 위저드가 PII 를 지정하지 않은 상태를 정확히 재현.
  - `expect(target?.attrs?.['이메일']).toBeUndefined()` 로 평문 부재 확인.
  - `contactPiiTable` 을 `contactTargetId` + `columnKey='이메일'` 조건으로 조회해 `toHaveLength(1)` 로 PII 행 존재 확인.
- 테스트가 스킵되지 않고 실제 실행됐는가: verbose 출력에서 7개 테스트 각각 개별 `✓` 표시 확인. (로컬이 아닌 DATABASE_URL 이면 `describe.skipIf(!isLocalDb)` 로 전체 파일이 스킵되지만, 로컬 127.0.0.1 URL 로 실행해 스킵되지 않고 통과함을 확인.)

## 커밋

```
a7a5691f test: 컨택 업로드 추가 모드와 PII 스킴 라우팅 realdb 검증 추가
```

- `git add` 는 `tests/integration/contact-upload-modes.realdb.test.ts` 1개 파일만 스코프.
- 이 세션과 무관하게 이미 modified 상태였던 `.superpowers/sdd/task-4-report.md`, 그리고 `?? prototypes/`, `?? tmp/` 는 스테이징/커밋에서 제외.
- 브랜치 `feat/contact-upload-modes` 유지, 이동 없음.

## Concerns

없음. 구현 코드 수정 없이 4개 테스트 모두 1회차 실행에서 GREEN.
