# Task 7 Report: 업로드 위저드 — 모드 선택·매칭 키 선택·기존 컬럼 잠금 UI

## Status: DONE

## Commit

`80e5122a` feat: 업로드 위저드 모드 선택과 매칭 키 선택 UI 추가

## Files changed

- `src/app/admin/surveys/[id]/operations/contacts/upload/new/page.tsx`
- `src/components/operations/contacts/upload-wizard.tsx`

## What was done

1. **page.tsx**: `getContactColumnScheme(surveyId, scope)` (`@/lib/operations/contacts.server`)
   호출을 추가해 `existingScheme`을 로드하고 `UploadWizard`에 prop으로 전달.

2. **upload-wizard.tsx**:
   - `UploadWizardProps`에 `existingScheme: ContactColumnScheme | null` 추가.
   - `Step` 타입에 `'match'` 추가 (렌더링은 Task 8).
   - 상태 추가: `mode`(ContactUploadMode, 기본 'replace'), `dupCheck`, `mergeKeys`.
   - 파생값: `schemeRouting`(`getSchemeRouting`), `lockedColumns`(Map<key, ContactColumnDef>),
     `isLockedMode`, `needsKeySelection`.
   - mapping 스텝 상단에 `existingContactsCount > 0`일 때만 모드 카드 3종(교체/병합/추가) +
     append 모드 전용 중복검사 토글 렌더. 모드 전환 시 `mergeKeys` 리셋.
   - 헤더 매트릭스에 `needsKeySelection`일 때 "매칭 키" 열 추가 (분류 기준 열 앞).
     PII 컬럼(`isPiiColumn = Boolean(lockedCol?.piiType ?? mapping.piiMapping[h])`)은
     체크박스 disabled + title 툴팁으로 사유 안내.
   - 기존 컬럼 잠금: `isLockedMode && lockedColumns.has(h)`인 행에서 라벨 input disabled(스킴
     라벨 표시), PII Select → 정적 텍스트 + "기존 설정" 배지, 표시 Checkbox disabled
     (`checked = !hidden`).
   - 매트릭스 아래에 유사 키 amber 경고: `mergeKeys` 중 `schemeRouting.knownAttrKeys`에 없는
     키만 대상으로 `suggestSimilarKeys` 결과 표시.
   - 기존 교체 경고 카드는 `mode === 'replace' && existingContactsCount > 0` 조건으로 변경 —
     replace 모드에서는 기존 동작·시각 그대로 유지.

## Task 8로 미룬 선언 (브리프 Step 3 명시 근거)

`tsconfig.json`의 `noUnusedLocals: true`로 인해 `npx tsc --noEmit`이 미사용 로컬 변수를
**에러**로 잡는다 (eslint의 `no-unused-vars`는 "warn"이라 무해했겠지만 tsc가 먼저 막음).
브리프 Step 3 지시("lint 에러가 나면 해당 선언만 Task 8로 미룰 것")에 따라 다음을 이번
태스크에서 제외했다:

- `unmatchedPolicy` / `setUnmatchedPolicy` (`useState<'insert' | 'skip'>('skip')`)
- `duplicatePolicy` / `setDuplicatePolicy` (`useState<'insert' | 'skip'>('skip')`)
- `matchResult` / `setMatchResult` (`useState<MatchContactUploadResult | null>(null)`) —
  모드 카드 onClick의 `setMatchResult(null)` 리셋 호출도 함께 제외.
- `needsMatchStep` 파생값 (`needsKeySelection`과 동일 정의, 매칭 스텝 게이팅용)

이 4개는 모두 이 태스크의 렌더 트리에서 전혀 읽히지 않아 (Task 8이 매칭 미리보기 스텝을
배선할 때 비로소 소비) tsc가 "declared but its value is never read"로 에러 처리했다.
`mode`, `dupCheck`, `mergeKeys`, `schemeRouting`, `lockedColumns`, `isLockedMode`,
`needsKeySelection`은 이번 태스크 UI에서 실제로 읽히므로 정상 유지했다. Task 8에서 매칭
미리보기 스텝을 렌더링하며 위 4개 선언과 `setMatchResult(null)` 리셋 호출을 함께
재도입해야 한다.

또한 `lockedColumns.get(h)`가 `ContactColumnDef | undefined`를 반환해 `isLocked` boolean
플래그만으로는 TS 타입 좁히기가 되지 않아(`TS18048`), `isLocked` 분기 안에서 `lockedCol!`
non-null assertion을 사용했다 (boolean 가드로 실질적으로 안전함이 보장됨).

## Verification

- `npx tsc --noEmit`: 에러 0
- `pnpm lint`: 163 warnings, 0 errors — 수정 전(같은 두 파일을 stash 후 측정) 기준선과
  **동일**(163 warnings, 0 errors). 두 수정 파일 자체에는 신규 warning 없음.
- `pnpm vitest run src/features/contacts tests/unit/contacts`: 16 test files, 89 tests,
  전부 통과 (무회귀).
- `UploadWizard`를 참조하는 테스트 파일 없음 (컴포넌트 직접 테스트 부재 확인).

## Self-review

- replace 모드(`mode==='replace'`, 기본값)에서: `isLockedMode=false`→잠금 UI 미노출,
  `needsKeySelection=false`→매칭 키 열·amber 경고 미노출, 교체 경고 카드는 그대로
  `existingContactsCount > 0`일 때 노출·`replaceConfirmed` 게이트 유지 — 기존 플로우와
  시각·동작 동일. 신규 모드 카드 3종은 `existingContactsCount > 0`일 때 추가로 보이는 것이
  브리프 의도(기존엔 모드 선택 UI 자체가 없었음).
- 모드 카드 클릭 및 dupCheck 토글 시 `mergeKeys`를 `new Set()`으로 리셋함을 코드로 확인.
- PII 컬럼 매칭 키 체크박스: `disabled={isPiiColumn}` + `title="개인정보 컬럼은 매칭
  키로 사용할 수 없습니다"` (isPiiColumn일 때만) 확인.
- 유사 키 경고: `mergeKeys`를 `schemeRouting.knownAttrKeys`로 필터링해 스킴에 등록된 attrs
  키는 경고 대상에서 제외됨을 확인.

## Concerns

없음. dev 서버 수동 확인(Step 4)은 브리프상 controller 소관이라 수행하지 않음. 브랜치
이동 없이 `feat/contact-upload-modes`에서 작업.
