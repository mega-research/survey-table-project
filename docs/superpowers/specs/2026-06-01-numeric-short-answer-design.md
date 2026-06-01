# 단답형 질문 "숫자만 입력" 설계

작성일: 2026-06-01
대상 브랜치: feature/profiles-filter-progress-style 후속 (신규 브랜치 권장)

## 배경 / 목표

테이블 셀 편집 모달("셀 내용 편집", `CellContentModal`)에는 input 셀에 대해 "숫자만 입력"
기능이 이미 구현되어 있다. 이 기능을 **일반 단답형(`type: 'text'`) 질문**에도 동일하게
적용한다. 기존 셀 구현의 필드명·유틸·로직을 그대로 재활용해 일관성을 유지한다.

가져올 기능 묶음 (사용자 확정: A + B + C 전체):

- **A. 입력 제한** — 응답자가 숫자만 입력 (`inputMode="decimal"` + `isPartialNumericInput` 검증)
- **B. 숫자 초기값** (`emptyDefault`) — 숫자 모드 시 입력란 자동 채움, 지우면 빈값 가능
- **C. 분기/표시 조건 숫자 비교** — `=, ≠, ≥, ≤, >, <` 연산자 사용

추가 확장 (사용자 요청):

- **D. SPSS export** — 숫자 단답형을 자동 Numeric 변수 + Continuous(척도) measure 로 처리
- **E. analytics 집계** — 숫자 단답형에 대해 숫자 통계(개수/합계/평균/최소/최대/중앙값) 표시

## 핵심 설계 결정

1. **필드명 재사용**: 셀과 동일하게 `Question.inputType: 'text' | 'number'`,
   `Question.emptyDefault: number` 사용. 유틸 `@/utils/numeric-input.ts`
   (`isPartialNumericInput`, `parseNumericInput`) 재사용.

2. **초기값(B)은 토큰 prefill 우선**: 단답형은 이미 `defaultValueTemplate`(토큰 prefill,
   응답자에게 readonly) 보유. `defaultValueTemplate` 이 설정돼 있으면 그것을 우선 적용하고
   `emptyDefault` 자동 채움은 건너뛴다. 토큰 prefill 이 비어있을 때만 `emptyDefault` 적용.
   빌더 UI 에서도 토큰 prefill 이 채워져 있으면 초기값 입력란을 비활성화하고 안내한다.

3. **C(조건 숫자 비교)는 신규 평가 코드 없음**: expression 조건 모드가 이미 단답형 응답값을
   `kind: 'question'` operand 로 받아 `toNumber` 로 변환해 비교한다
   (`branch-logic.ts:1101`, `evaluateExpressionOperand`). "숫자만 입력"은 저장값을 숫자로
   보장해 이 비교의 신뢰성을 높인다. 설계 문서/빌더 안내에 "숫자 비교는 expression 조건으로
   설정" 만 명시. 별도 비교 UI 신규 개발은 하지 않는다.

4. **빈값(missing) vs 숫자 0 구분 (사용자 강조)**: `parseNumericInput('')` 은 `null`,
   `parseNumericInput('0')` 은 `0` 을 반환한다. SPSS·analytics 모두 이 함수를 사용해
   **빈 입력만 missing 으로 제외하고 실제 입력된 0 은 유효값으로 포함**한다.
   `emptyDefault: 0` 으로 자동 채워진 응답도 "0" 으로 저장되어 실제 0 값으로 집계된다.

## 데이터 모델

### 타입 (`@/types/survey.ts` `Question`)

```ts
// 단답형(text) 타입용 — 셀 input 과 동일 의미
inputType?: 'text' | 'number';   // 'number' 면 응답자가 숫자만 입력 가능
emptyDefault?: number;            // 숫자 모드 첫 진입 시 자동 채움 (토큰 prefill 없을 때만)
```

### DB (`@/db/schema/surveys.ts` `questions`)

전용 컬럼 2개 추가 (placeholder/defaultValueTemplate 와 동일 패턴):

```ts
inputType: text('input_type'),                  // 'text' | 'number'
emptyDefault: doublePrecision('empty_default'),  // 숫자 초기값
```

마이그레이션은 `pnpm db:generate` 로 생성(`_journal.json` 갱신) 후 적용.
(메모: drizzle migrate 는 `_journal.json` 만 따라가므로 수동 SQL 금지)

### 파생 타입 동기화

- `@/db/schema/schema-types.ts` 의 question 타입에 `inputType?`, `emptyDefault?` 추가
- `@/lib/versioning/snapshot-builder.ts` snapshot 타입 + 매핑에 추가
  (**응답 페이지는 snapshot 기반** → 누락 시 발행된 설문에서 숫자 제한 미적용)

## 저장 경로 배관

`feedback_survey_save_explicit_fields` 반영 — explicit 필드 site 모두 점검:

| 위치 | 작업 |
|------|------|
| `survey-save-actions.ts` (함수 2개 × insert + onConflict excluded) | `inputType`, `emptyDefault` 추가 (약 8곳) |
| `data/surveys.ts:156` 로더 매핑 | `inputType`, `emptyDefault` 매핑 추가 |
| `snapshot-builder.ts` | snapshot 타입 + 매핑 추가 |
| `question-edit-modal.tsx` hydrate 블록(~161) | 2필드 hydrate (저장은 `...currentFormData` spread 라 자동 전달) |

## 빌더 UI — `question-basic-tab.tsx` (`type === 'text'` 블록, ~431)

placeholder / 응답값 prefill 아래에 셀 모달과 동일한 UI 이식:

- "숫자만 입력" 체크박스 (`formData.inputType === 'number'`) + 동일 설명 문구
  ("체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건에서 비교 연산자 ... 를 사용할 수 있습니다.")
- 숫자 모드 ON 일 때만 노출되는 "응답자 입력란 초기값" 입력 (`emptyDefault`,
  `isPartialNumericInput` 검증, `parseNumericInput` 으로 저장)
- `defaultValueTemplate` 이 채워져 있으면 초기값 입력란 **비활성화 + 안내 문구**

체크 해제 시 `inputType` 을 `'text'`(또는 undefined)로, `emptyDefault` 를 undefined 로 정리.

## 응답 렌더링 — `question-input.tsx` `TextResponseInput` (~481)

`cells/input-cell.tsx` 로직 재활용:

- `isNumberMode = question.inputType === 'number'`
- 숫자 모드: `<Input>` 에 `inputMode="decimal"`, `onChange` 에서 `isPartialNumericInput(value)`
  실패 시 입력 거부
- 초기값 자동 채움: 토큰 prefill(`isPrefilled`)이 **아니고** `emptyDefault` 가 number 이며
  현재 값이 없을 때 `String(emptyDefault)` 로 1회 채움. 응답자가 지우면 빈값 유지(재채움 X)
- 토큰 prefill 있으면 기존 readonly(`disabled`) 동작 그대로 유지 (prefill 우선)

## D. SPSS Export — `lib/spss/sav-builder.ts`, `lib/spss/data-transformer.ts`, `lib/analytics/spss-excel-export.ts`

1. `resolveVarType` (sav-builder.ts:45) `case 'text'`:
   `question?.inputType === 'number'` 이면 `VariableType.Numeric`, 아니면 기존 `String`.
2. `resolveMeasure` (sav-builder.ts:92): 숫자 단답형이면 `VariableMeasure.Continuous`,
   아니면 기존 폴백(`Nominal`).
3. 데이터 기록: `generateSPSSColumns` (spss-excel-export.ts:362) text 컬럼 생성 시
   `q.inputType === 'number'` 를 컬럼 메타(예: `numericText?: boolean`)로 전파. 변환부
   (`case 'text'`, spss-excel-export.ts:667) 에서 `numericText` 이면 `parseNumericInput(value)`
   로 number|null 반환(빈값/비숫자 → null = system-missing). 일반 text 는 기존 `transformText`.
   - Numeric 변수에는 문자열이 아닌 number 가 들어가야 하므로 이 분기 필수.
4. 기존 `question.spssVarType` / `spssMeasure` 수동 오버라이드 우선순위는 그대로 유지
   (오버라이드 > inputType 자동 판단).

## E. Analytics — `lib/analytics/types.ts`, `lib/analytics/analyzer.ts`, `components/analytics/charts/text-responses.tsx`

1. `types.ts`: `NumericStats` 인터페이스 신규 + `TextAnalytics.numericStats?: NumericStats`.

   ```ts
   export interface NumericStats {
     count: number;   // 유효 숫자 응답 수 (빈값 제외, 0 포함)
     sum: number;
     mean: number;
     min: number;
     max: number;
     median: number;
   }
   ```

2. `analyzer.ts` `analyzeText` (~252): `question.inputType === 'number'` 이면 응답값을
   `parseNumericInput` 으로 변환, `null`(빈값/비숫자)만 제외하고 **0 은 포함**해 통계 계산 후
   `numericStats` 채움. 텍스트 단어 빈도/평균 길이는 숫자 모드에서는 생략하거나 보조로 둔다.
3. `text-responses.tsx`: `data.numericStats` 존재 시 숫자 통계 카드(개수/합계/평균/최소/최대/중앙값)
   렌더. 기존 텍스트 응답 목록은 함께 표시(원자료 확인용).

## 범위 외

- 테이블 input 셀(`cell.inputType === 'number'`)에 대한 analytics 숫자 통계는 이번 범위 밖
  (질문 단위 단답형만 대상). 동일 `NumericStats` 패턴으로 추후 확장 가능.
- `textarea` 타입은 대상 아님 (단답형 `text` 만).
- analytics 필터(`filter.ts`)의 숫자 연산자 단답형 확장은 선택 — 본 설계 필수 아님.

## 테스트 전략

(메모: ESLint 인프라 깨짐 → `tsc + vitest + build` 로 검증. vitest 는 `tests/` 만 include)

- 유틸/순수 로직 우선: `parseNumericInput` 기반 통계 계산을 순수 함수로 분리해 단위 테스트
  (빈값 제외 / 0 포함 / 음수 / 소수 / 비숫자 혼입 케이스).
- SPSS 변환: 숫자 단답형 컬럼의 `resolveVarType=Numeric`, `resolveMeasure=Continuous`,
  값 변환 `'0' → 0`, `'' → null` 검증 (tests/ 패턴).
- analyzer: 숫자 단답형 응답 배열 → `numericStats` 정확성, 0 포함 확인.
- 빌더/응답 UI 는 수동 검증 (테스트 모드 + 발행 후 응답 페이지).

## 구현 순서(요약)

1. 타입 + DB 컬럼 + 마이그레이션 + 파생 타입(schema-types, snapshot) 동기화
2. 저장 배관(survey-save-actions, data/surveys, edit-modal hydrate)
3. 빌더 UI(question-basic-tab)
4. 응답 렌더링(TextResponseInput)
5. SPSS(D)
6. analytics(E)
7. 검증(tsc/vitest/build) + 수동 확인
