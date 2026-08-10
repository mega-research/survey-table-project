# Task 8 리포트: 매칭 미리보기 스텝 + 적재 배선 + 결과 확장

> 이전 버전의 이 파일은 무관한 다른 작업("응답 클라이언트 attempt")의 리포트였다. 이 태스크(컨택 업로드
> 모드 - 매칭 미리보기 스텝) 결과로 전체 덮어씀.

## 상태: DONE

## 변경 파일

- 신규: `src/components/operations/contacts/upload-match-step.tsx` — 브리프 코드 그대로 작성
- 수정: `src/components/operations/contacts/upload-wizard.tsx` — 상태 선언, buildMapping, handleMatchPreview,
  버튼 분기, match 스텝 렌더, result 확장, 단계 표시기, 리셋 배선
- 수정(범위 외, 컴파일 필수): `src/hooks/queries/index.ts` — `useMatchContacts` 가 Task 4 에서 훅 파일
  (`use-contacts.ts`)에는 추가됐지만 배럴(`index.ts`)에서 재-export 되지 않아 `upload-wizard.tsx` 의
  import 가 `TS2305` 로 실패. `useParseExcelPreview`/`useIngestContacts` 옆에 `useMatchContacts` 한 줄
  추가로 해소. 브리프는 2파일 scoped 를 명시했으나, 이 누락은 Task 8 착수 시점에 이미 존재하던 배선
  공백이라 같은 커밋에 포함했다(prototypes/, tmp/ 는 여전히 제외).

## Step 1: UploadMatchStep

브리프 코드 그대로 신규 작성. 요약 카운터, 빈 값 덮어쓰기 경고, merge/append 별 정책 라디오,
자동 제외 안내, 4종 SampleList(불일치/신규, 파일 내 키 중복, 다중 일치, 키 빈 값), 뒤로가기/적재 시작 버튼.

## Step 2: 위저드 배선

1. **상태 선언**: `unmatchedPolicy`(기본 `'skip'`), `duplicatePolicy`(기본 `'skip'`), `matchResult`
   (`MatchContactUploadResult | null`), `result` 를 `IngestContactUploadResult | null` 로 확장.
   `needsMatchStep = needsKeySelection` 파생값 추가 (merge 는 항상, append 는 중복검사 on 일 때만).
2. **buildMapping()**: mapping/mergeKeys/unmatchedPolicy/duplicatePolicy 를 `ContactUploadMapping` 으로
   조립하는 공용 헬퍼. `handleMatchPreview`/`handleIngest` 양쪽에서 사용.
3. **handleMatchPreview**: `matchContacts.mutateAsync` 호출 → `setMatchResult` → `setStep('match')`.
4. **버튼 분기 (이관 수정 1)**: mapping 스텝 적재 버튼 disabled 를
   `(mode === 'replace' && existingContactsCount > 0 && !replaceConfirmed) || (needsKeySelection && mergeKeys.size === 0)`
   로 교체. onClick 은 `needsMatchStep ? handleMatchPreview : handleIngest`.
5. **match 스텝 렌더**: `step === 'match' && matchResult && (mode === 'merge' || mode === 'append')` 가드로
   `UploadMatchStep` 렌더. onBack → `setStep('mapping')`, onConfirm → `handleIngest`.
6. **handleIngest**: `buildMapping()` 사용으로 교체, `setResult(r)` 로 `IngestContactUploadResult` 전체 저장.
7. **result 스텝**: 신규 적재/갱신/제외(skippedBreakdown 4분류: 정책·파일 내 중복·다중 일치·키 빈 값)/에러 표시.
8. **단계 표시기**: `needsMatchStep` 이면 4단계(파일→컬럼 설정→매칭 미리보기→결과), 아니면 3단계.
9. **리셋 (이관 수정 2)**: `handlePreview` 성공 시 `setMode('replace')`, `setDupCheck(false)`,
   `setMergeKeys(new Set())`, `setMatchResult(null)` 추가. "다른 파일 업로드" 리셋에도 동일 4개 추가.

## Step 3: 타입/lint

- `npx tsc --noEmit`: 0 에러.
- `pnpm lint`: 0 에러, 163 경고 — 전부 우리 파일과 무관한 기존 경고(`any` 사용, 기존 useCallback 의존성 등).
  `upload-wizard.tsx`/`upload-match-step.tsx`/`hooks/queries/index.ts` 관련 warning 0건(개별 grep 확인).

## Step 4: 무회귀 테스트

`pnpm vitest run src/features/contacts tests/unit/contacts` → 16 test files / 89 tests 전부 통과.

## Step 4(브리프): dev 서버 수동 E2E

브리프 원문은 `pnpm dev` 수동 확인을 요구하지만, 이 태스크의 Context 지시에 "dev 서버 수동 확인은
controller 소관 — 하지 말 것" 이 명시되어 있어 수행하지 않았다. 아래 Self-Review(로직 추적)로 대체 검증.

## Self-Review (로직 추적)

1. **merge + 기존명단>0 + 키 선택됨 → "매칭 확인" 활성?**
   `mode==='merge'` 이므로 replace 절 false. `needsKeySelection` true, `mergeKeys.size>0` 이면 두 번째 절도
   false → `disabled=false`. `onClick = handleMatchPreview` (needsMatchStep true). 활성 확인.
   **replace 모드**는 needsKeySelection 이 항상 false 이므로 이 조건엔 영향 없고, 여전히
   `existingContactsCount > 0 && !replaceConfirmed` 로만 게이트 — 동의 체크박스 요구 유지 확인.

2. **append + dupCheck off → match 스텝 없이 바로 적재?**
   `needsKeySelection = mode==='merge' || (mode==='append' && dupCheck)` → dupCheck false 이면 false.
   `needsMatchStep` false → 버튼 onClick 이 `handleIngest` 직행. 확인.

3. **match 스텝 뒤로가기 후 재확인 시 stale matchResult 없음?**
   `onBack`은 `setStep('mapping')`만 수행, `matchResult` 는 유지하지만 렌더 조건이 `step==='match'` 를
   요구해 미표시. 재클릭 시 `handleMatchPreview` 가 새 결과로 `setMatchResult` 를 덮어쓴 뒤에만
   `setStep('match')` 호출 — 화면에 이전 값이 노출되지 않음. 확인.

4. **result 화면 skippedBreakdown 4분류 표시?**
   `result.skippedRows > 0` 일 때 정책/파일 내 중복/다중 일치/키 빈 값 4개 카운트 모두 렌더. 확인.

## 커밋

`b389d849` feat: 업로드 위저드 매칭 미리보기 스텝과 모드별 적재 배선 추가

(3 files changed: upload-match-step.tsx 신규, upload-wizard.tsx, hooks/queries/index.ts)

## 우려 사항

- `useMatchContacts` 배럴 export 누락은 이 태스크에서 발견·수정했지만, 원래는 Task 4(matchPreview RPC)
  범위의 배선 공백이었다. Task 10 전체 리뷰 시 Task 4 리포트와 대조해 인지시킬 것.
- `.superpowers/sdd/task-4-report.md`, `task-6-report.md`, `task-7-report.md` 가 작업 시작 전부터 이미
  워킹 트리에 수정 상태(unstaged)로 남아 있었음 — 이 태스크에서 건드리지 않았고 git add 대상에서도 제외함.
- `prototypes/`, `tmp/` 는 세션 시작부터 untracked 상태였고 이번 커밋에 포함하지 않았다.
