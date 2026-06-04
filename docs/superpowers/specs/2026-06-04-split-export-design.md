# 분할 내보내기 (Split Raw Export) 설계

작성일: 2026-06-04
관련 1회성 스크립트: `scripts/export-pummok-split.mts`
디자인 출처: Claude Design 핸드오프 번들 `응답 데이터 내보내기.html` (export-modal-data/steps/modal.jsx) — chat3.md 기준 본 설계 아키텍처를 시각화한 결과물

## 1. 배경 / 문제

현재 raw export(`type=raw`)는 단일 워크북에 **응답내역 / Raw Data / 코딩북** 3시트를 만든다. Raw Data 시트는 `generateSPSSColumns()`가 만든 변수(열)를 그대로 펼치는데, 대형 트래킹 설문(예: 목재이용실태조사 통합본, 인터랙티브 셀 47,417개)은 변수 수가 Excel 한 시트 열 한계(16,384)를 넘어 **시트가 잘린다**.

`export-pummok-split.mts`는 이 문제의 1회성 해결책으로, `displayCondition`이 특정 기준 문항(Q2 품목)을 value-match 하는 질문/행을 기준으로 품목별 시트를 만들어 분할했다. 본 설계는 이 스크립트를 **"분할 기준 문항을 UI에서 고르는" 제품 기능**으로 일반화한다.

## 2. 확정된 핵심 결정

| 항목 | 결정 |
|------|------|
| 기준 문항 선택 방식 | **자동 추천 + 미리보기**. 시스템이 후보를 추천하고, 후보 선택 시 시트 수·시트별 변수 수를 즉시 계산해 보여준다. |
| 노출 조건 | **기존 모달 + 초과 시만**. 전체 변수 수가 임계치를 넘을 때만 "분할 내보내기" 흐름이 노출된다. |
| 임계치(SOFT_LIMIT) | **10,000열**. Excel 하드 한계 16,384보다 낮은 안전 마진. 분할 권장 트리거 + 시트별 검증에 동일 적용. |
| 시트 구성 | **응답내역(1) + 공통(1) + 기준 옵션별 RawData(N) + 코딩북(1)**. |
| 행 처리 | **열만 분할**. 모든 RawData/공통 시트에 전체 응답자가 동일 순번으로 등장. 변수(열)만 옵션별로 갈린다. 미리보기의 "응답 수"는 **정보용**(해당 옵션을 실제 선택한 응답자 수)이며 행 필터가 아니다. |
| 다중 옵션 조건 변수 | **중복 허용**. `displayCondition`이 `옵션1 OR 옵션3`이면 해당 변수는 옵션1 시트·옵션3 시트 양쪽에 동일 열로 들어간다(손실 방지). |
| 분할 기준 조건 타입 | `conditionType === 'value-match'` 만. `table-cell-check`/`expression`은 옵션 토큰 개념이 맞지 않아 후보/버킷 산정에서 제외. |

### 열만 분할을 택한 이유 (디자인과의 차이 메모)

디자인 시각화는 시트마다 응답 수가 다른 **행+열 분할(분기 기반)** 로 그려졌으나, 실제 프로덕션 케이스(Q2=다중품목 checkbox)는 한 응답자가 여러 옵션에 걸쳐 행 분할 시 합계가 전체를 초과한다. 또한 열만 분할은 모든 시트가 동일 순번 행 집합을 가져 **순번 기준 SPSS 병합**이 가능하다. 따라서 행은 전체 공통으로 두고, 디자인의 "응답 수" 컬럼은 의미를 "옵션 선택자 수(정보용)"로 재해석해 시각은 보존한다.

## 3. 아키텍처

```
[모달] src/components/analytics/export-data-modal.tsx
   │  ① 모달 열림 → 전체 변수 수 조회 → > SOFT_LIMIT 이면 "분할 내보내기" 카드 노출
   │  ② 카드 클릭 → split-preview(basis 없이) → 후보 문항 추천 목록
   │  ③ 후보 선택 → split-preview(basis=Qid) → 시트별 변수 수 미리보기
   │  ④ "분할 다운로드" → export?type=raw-split&basis=Qid
   ▼
[API] src/app/api/surveys/[surveyId]/export/
   ├─ split-preview/route.ts (GET, JSON)            ← 신설
   │     basis 없음 → detectSplitCandidates()
   │     basis 있음 → planSplit()
   └─ export/route.ts (GET, xlsx)                    ← ALLOWED_EXPORT_TYPES 에 'raw-split' 추가
         buildSplitWorkbook()
   ▼
[모듈] src/lib/analytics/split-export.ts            ← 신설 (순수 함수, 테스트 대상)
   ├─ detectSplitCandidates(questions): SplitCandidate[]
   ├─ planSplit(questions, basisQuestionId): SplitPlan
   └─ buildSplitWorkbook(questions, rows, basisQuestionId, identifierMode): ExcelJS.Workbook
         └─ generateSPSSColumns / buildDataRows + generateRawDataWorkbook 의 헤더·스타일·병합 헬퍼 재사용
```

**핵심 원칙**: `planSplit`과 `buildSplitWorkbook`이 **동일한 버킷팅 함수**(`bucketQuestions`)를 공유한다. 미리보기 숫자와 실제 다운로드 결과가 항상 일치한다. 변수 수 계산은 서버 `generateSPSSColumns`를 그대로 써서 raw export와 셈법이 어긋나지 않는다.

## 4. 모듈 상세 — `src/lib/analytics/split-export.ts`

### 4.1 타입

```ts
interface SplitCandidate {
  questionId: string;
  code: string;        // questionCode (예: "Q2")
  label: string;       // 질문 title
  type: string;        // radio | checkbox | select | multiselect
  refCount: number;    // 이 문항을 value-match 참조하는 displayCondition 수
  buckets: number;     // 분할 시 옵션 시트 수
  maxVars: number;     // 시트 중 최대 변수 수
  recommended: boolean;
  note: string;        // 자동 생성 설명
}

interface SplitSheetPlan {
  token: string;       // 옵션 value (또는 'other')
  name: string;        // 옵션 label (시트명, sanitize)
  vars: number;        // 이 시트의 변수 수 (공통 제외한 옵션 전용)
  resp: number;        // 이 옵션을 선택한 응답자 수 (정보용)
}

interface SplitPlan {
  basisQuestionId: string;
  basisCode: string;
  basisLabel: string;
  common: number;          // 공통 시트 변수 수
  sheets: SplitSheetPlan[];
  maxVars: number;         // 공통 + 옵션 시트 중 최대
  exceedsSoftLimit: boolean;
  exceedsExcelLimit: boolean;
}
```

### 4.2 버킷팅 — `bucketQuestions(questions, basisQuestionId, bucket)`

`export-pummok-split.mts`의 `q2Set()` / `filterForBucket()`를 일반화한다.

- `valueMatchSet(dc, basisId)`: `dc.conditions` 중 `conditionType==='value-match' && sourceQuestionId===basisId && requiredValues.length>0` 인 조건의 `requiredValues`를 Set으로 합쳐 반환, 없으면 null.
- 버킷 = `'common'` 또는 옵션 토큰.
  - **common**: 질문 displayCondition에 basis value-match 없음. 테이블이면 basis 조건 없는 행만 남긴 복사본. 비테이블 공통 질문도 common.
  - **옵션 토큰 T**: 질문이 basis 전용(`qset.has(T)`) → 질문 전체. 질문은 공통이나 테이블 행이 `rset.has(T)` → 해당 행만. 다중 토큰 질문/행은 각 토큰 버킷에 **중복**.
- 반환: 그 버킷에 속한 질문 배열(테이블은 `tableRowsData` 필터링된 복사본).

### 4.3 옵션 토큰 / 라벨 도출

- 토큰 목록 = 기준 문항의 `options[].value` 중 **displayCondition value-match의 requiredValues에 실제 등장하는 것** ∪ (등장하나 옵션에 없는 토큰; 예: `'other'`).
- 라벨 = `options[].label` 매핑. 매핑 없으면 토큰 문자열 폴백.
- 빈 버킷(변수 0)인 옵션 토큰은 시트 생성 제외.

### 4.4 변수 수 계산

각 버킷에 `generateSPSSColumns(bucketQuestions(...))`를 돌려 `.length`로 변수 수를 센다. `common` 버킷 변수는 모든 옵션 시트에 **공통 포함**되지 않고 별도 "공통" 시트 1개로 분리(시트 구성 결정). 따라서 옵션 시트 변수 = 옵션 전용 변수만.

> 참고: 디자인 카피의 "공통 변수 N개는 모든 시트에 포함" 문구는 본 설계에선 "공통 시트로 분리"로 해석. 미리보기 푸터 문구를 그에 맞게 조정한다.

### 4.5 추천 로직 — `detectSplitCandidates`

1. 모든 질문·테이블행·테이블열·동적행그룹의 `displayCondition`을 스캔해 value-match `sourceQuestionId` 빈도(`refCount`) 집계.
2. 각 후보에 `planSplit`을 돌려 `buckets`/`maxVars` 산출.
3. 정렬: `maxVars` 오름차순(작을수록 좋음) 우선, 동률이면 `buckets` 적은 순.
4. `recommended = maxVars <= SOFT_LIMIT`. (모두 초과면 최선 1~2개에만 추천 배지)
5. `note` 자동 생성: "분기 경계가 깔끔해 시트 변수가 가장 고르게 작아짐" / "시트가 N개로 많지만 시트당 변수는 가장 적음" / "일부 시트가 한계에 근접" 등 규칙 기반.

### 4.6 워크북 생성 — `buildSplitWorkbook`

- 시트 순서: `응답내역` → `공통` → 옵션 시트(N) → `코딩북`.
- 응답내역: 전체 응답자(기존 raw의 응답내역 시트 로직 재사용).
- 공통/옵션 시트: 각각 `bucketQuestions` 결과로 `generateSPSSColumns` → `buildDataRows(columns, 전체질문, 전체응답)` → 헤더 3행(질문제목/셀·옵션라벨/SPSS변수명) + 데이터. 행은 전체 응답자(열만 분할). 헤더 병합·스타일·열너비는 `generateRawDataWorkbook`의 헬퍼 재사용.
- 코딩북: **전체 변수**(공통 ∪ 모든 옵션 변수, 토큰 중복 제거) 1시트. 기존 raw 코딩북 로직 재사용.
- 시트명 sanitize: Excel 31자 제한, `[]:*?/\` 제거, 중복 시 접미사(`~2`).

## 5. API

### 5.1 `GET .../export/split-preview` (신설, JSON)

- 인증: `requireAuth()` (기존 export route와 동일).
- 질문 로드 + 셀/옵션 코드 hydrate(`generateAllCellCodes`/`generateAllOptionCodes`) — 기존 export route 패턴 그대로.
- query `basis` 없음 → `{ totalVars, softLimit, excelLimit, candidates: SplitCandidate[] }`.
- query `basis=Qid` 있음 → `{ plan: SplitPlan }`.
- 응답 수(`resp`) 집계: `survey_responses`에서 옵션별 선택자 수. `notDeletedResponse` + `status != 'in_progress'` 필터(raw export와 동일 모집단).

### 5.2 `GET .../export?type=raw-split&basis=Qid` (기존 route 확장)

- `ALLOWED_EXPORT_TYPES`에 `'raw-split'` 추가. `basis` 누락/유효하지 않으면 400.
- 응답 모집단·`MAX_EXPORT_RESPONSES`(10,000) 제한은 raw와 동일.
- `buildSplitWorkbook(...)` → `xlsx.writeBuffer()` → 파일명 `{title}_분할_{basisCode}_{YYYY-MM-DD}.xlsx`.

## 6. 모달 UI — `export-data-modal.tsx`

디자인의 4-step 상태머신을 기존 모달에 통합. 상태: `options → candidates → preview → downloading → done`.

- **options**: 기존 형식 카드(현재 raw만 활성) 유지 + 상단에 응답/문항/총변수 pill. `totalVars > SOFT_LIMIT`이면 노란 경고 카드 + "분할 내보내기 설정" 버튼(→ candidates). 총변수는 split-preview(basis 없음)로 조회.
  - 식별자 모드(`anon/id/contact`) Segmented는 기존 raw export의 `identifierMode`와 연결.
  - 디자인의 spss/codebook segmented는 시각화일 뿐 — 실제 활성 형식 범위는 현행 유지(별도 확장 아님).
- **candidates**: `detectSplitCandidates` 결과 라디오 카드(코드칩·라벨·권장배지·N개 시트·최대 변수·✓/⚠). 후보 없으면 "value-match 조건 문항이 없어 분할 기준을 찾지 못했습니다" 안내.
- **preview**: `planSplit(basis)` 테이블(시트명·응답수·변수+한계대비 막대·상태). 푸터: 공통 변수 수 + 최대 변수.
- **downloading/done**: 실제 다운로드 트리거(`export?type=raw-split&basis=`) 후 스피너→체크.
- 데이터 페칭: TanStack Query. basis 바뀔 때 plan 재요청.
- 비주얼 토큰: 기존 프로젝트(Pretendard, blue-600, rounded, `button.tsx`) 따름. 디자인의 인라인 스타일은 프로젝트 컴포넌트/Tailwind로 치환.

## 7. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| value-match 조건 없는 설문 | 후보 0 → candidates 스텝에 안내, 분할 불가 |
| 옵션 시트가 SOFT_LIMIT 초과 | ⚠ 표시, 다운로드 허용. EXCEL_LIMIT 초과면 강한 경고(+해당 시트 잘림 가능 고지) |
| requiredValues 토큰이 옵션 목록에 없음(other 등) | 라벨 폴백(토큰 문자열 또는 '기타') |
| 다중 토큰 변수 | 각 토큰 시트에 중복(의도) |
| 시트명 31자 초과/중복/특수문자 | sanitize + 중복 접미사 |
| basis 문항 자체 변수 | basis 조건이 없으므로 공통 시트로 |
| 응답 0건 | 헤더만 있는 시트(기존 raw와 동일 동작) |

## 8. 테스트 (`tests/` · vitest)

`tests/unit/split-export.test.ts`:
- `valueMatchSet`: value-match만 잡고 table-cell-check/expression 무시.
- `bucketQuestions`: 공통/옵션 전용/다중 토큰 중복/테이블 행 필터.
- `detectSplitCandidates`: refCount 빈도, 정렬, recommended 임계.
- `planSplit`: 버킷별 변수 수, maxVars, exceeds 플래그.
- **일관성**: 같은 입력에서 `planSplit`의 시트별 변수 수 == `buildSplitWorkbook`이 만든 각 시트 열 수.

> vitest는 `tests/` 디렉토리만 include. `src/` 옆 `*.test.ts`는 silent skip이므로 반드시 `tests/`에 둔다.

## 9. 범위 밖 (YAGNI)

- 옵션 시트가 여전히 한계 초과 시 **2차 분할** — 하지 않음(경고만).
- 다중 기준 문항(2개 교차 분할) — 단일 기준만.
- 행+열 분할(분기 모드) — 열만 분할 확정.
- SPSS(.sav)/코드북 분할 — raw만.
