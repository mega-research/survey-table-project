# 옵션 상세기입 필수 검증 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 필수 질문 또는 필수 선택형 셀에서 선택된 `allowTextInput` 옵션의 상세기입이 비어 있으면 다음 이동과 설문 완료를 차단한다.

**Architecture:** 선택 응답에서 실제 선택된 옵션 ID를 구하는 로직을 기존 제출 필터와 공유하고, 새 순수 검증 모듈이 질문 단위 누락과 필수 셀 단위 누락을 계산한다. 응답 흐름은 Zustand의 `optionTexts`를 구독해 필수 질문 판정에 반영하고, 테이블 검증은 같은 순수 모듈의 셀 누락 결과를 기존 `required-cells` 이슈에 합친다.

**Tech Stack:** TypeScript 5.9 strict, React 19, Zustand 5, Vitest 4, Testing Library

## Global Constraints

- 질문의 `required`가 `true`이고 선택된 옵션의 `allowTextInput`이 `true`이면 상세기입을 필수로 검사한다.
- 테이블 셀의 `required`가 `true`이고 해당 셀에서 선택된 옵션의 `allowTextInput`이 `true`이면 상세기입을 필수로 검사한다.
- 빈 문자열과 공백 문자만 있는 값은 미입력으로 처리한다.
- 상세기입 옵션을 선택하지 않았다면 해당 텍스트를 검사하지 않는다.
- 질문이나 셀이 필수가 아니라면 상세기입 옵션을 선택해도 텍스트 입력을 강제하지 않는다.
- radio, checkbox, select, ranking과 테이블 소스 선택 옵션에 동일한 규칙을 적용한다.
- 화면에 표시되지 않는 질문·행·열·셀은 기존 필수 검증과 동일하게 검사 대상에서 제외한다.
- 기존 필수 질문 하이라이트와 `required-cells` 오류 UI를 재사용한다.
- DB 스키마, `__optTexts__` 저장 형식, 엑셀·SPSS 내보내기는 변경하지 않는다.

---

## File Map

**Create**

- `src/lib/survey/required-option-text-validation.ts` — 질문·셀 상세기입 누락을 계산하는 순수 함수
- `tests/unit/required-option-text-validation.test.ts` — 선택형 질문·테이블 셀·순위형 검증 계약

**Modify**

- `src/lib/option-text-migration.ts` — 제출 필터와 검증이 공유하는 선택 옵션 ID 추출 함수 공개
- `tests/integration/option-text-migration.test.ts` — 선택 옵션 ID 추출의 값→ID 매핑 회귀 테스트
- `src/components/survey-response/survey-response-flow.tsx` — `optionTexts` 구독과 필수 질문 판정 연결
- `tests/unit/survey-response/required-option-text-flow.test.tsx` — 다음 이동 차단과 공백 처리
- `src/lib/survey/numeric-validation.ts` — 필수 셀의 상세기입 누락을 `required-cells`에 병합
- `tests/unit/numeric-validation.test.ts` — 필수 선택형 셀 상세기입 검증

---

### Task 1: 선택 옵션 판정과 순수 상세기입 검증

**Files:**

- Create: `src/lib/survey/required-option-text-validation.ts`
- Create: `tests/unit/required-option-text-validation.test.ts`
- Modify: `src/lib/option-text-migration.ts`
- Modify: `tests/integration/option-text-migration.test.ts`

**Interfaces:**

- Produces: `collectSelectedOptionIds(value, options): Set<string>`
- Produces: `collectRequiredOptionTextIssues(question, response, optionTexts): { questionMissing: boolean; cellIds: string[] }`
- Consumes: `Question`, `QuestionOption`, `RankingAnswer`, `resolveChoiceOptions`, `resolveRankingOptions`, `parseRankingAnswers`

- [ ] **Step 1: 선택 옵션 ID 추출 테스트를 작성한다**

```ts
it('응답 value를 옵션 id로 변환하고 그룹 응답도 펼친다', () => {
  const options = [
    { id: 'id-a', value: 'value-a' },
    { id: 'id-b', value: 'value-b' },
  ];
  expect([...collectSelectedOptionIds({ g1: 'value-a', g2: ['value-b'] }, options)])
    .toEqual(['id-a', 'id-b']);
});
```

- [ ] **Step 2: 선택 옵션 ID 테스트가 RED인지 확인한다**

Run: `pnpm exec vitest run tests/integration/option-text-migration.test.ts`

Expected: FAIL because `collectSelectedOptionIds` is not exported.

- [ ] **Step 3: 기존 제출 필터의 선택값 추출을 함수로 분리한다**

```ts
export function collectSelectedOptionIds(
  value: unknown,
  options?: { id: string; value: string }[],
): Set<string> {
  const selectedValues = new Set<string>();
  // 기존 filterOptionTextsForSubmission의 string, array, object, RankingAnswer 처리 유지
  // options가 있으면 value→id로 변환하고, 없으면 value를 id로 사용
  return selectedIds;
}
```

`filterOptionTextsForSubmission`은 새 함수를 호출하고 기존 결과를 그대로 유지한다.

- [ ] **Step 4: 선택 옵션 ID와 기존 제출 필터 테스트를 GREEN으로 확인한다**

Run: `pnpm exec vitest run tests/integration/option-text-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: 질문·셀 상세기입 누락 테스트를 작성한다**

```ts
it('필수 radio 질문에서 선택한 상세기입 옵션이 공백이면 질문 누락이다', () => {
  const question = makeQuestion({
    type: 'radio',
    required: true,
    options: [{ id: 'other', value: 'other-value', label: '기타', allowTextInput: true }],
  });
  expect(
    collectRequiredOptionTextIssues(question, 'other-value', { other: '   ' }),
  ).toEqual({ questionMissing: true, cellIds: [] });
});

it('선택 사항 질문은 상세기입이 공백이어도 누락이 아니다', () => {
  const question = makeQuestion({
    type: 'radio',
    required: false,
    options: [{ id: 'other', value: 'other-value', label: '기타', allowTextInput: true }],
  });
  expect(
    collectRequiredOptionTextIssues(question, 'other-value', { other: '' }),
  ).toEqual({ questionMissing: false, cellIds: [] });
});

it('필수 checkbox 질문은 선택된 상세기입 옵션마다 값이 필요하다', () => {
  const question = makeQuestion({
    type: 'checkbox',
    required: true,
    options: [
      { id: 'a', value: 'a', label: 'A', allowTextInput: true },
      { id: 'b', value: 'b', label: 'B', allowTextInput: true },
    ],
  });
  expect(
    collectRequiredOptionTextIssues(question, ['a', 'b'], { a: '작성', b: '\n\t' }),
  ).toMatchObject({ questionMissing: true });
});
```

테이블 radio·checkbox·select 셀, 질문 및 셀 ranking의 `RankingAnswer.optionText`,
테이블 소스 `choice_opt`·`ranking_opt`, 비선택 옵션, 유효 텍스트 사례도 각각 추가한다.

- [ ] **Step 6: 순수 검증 테스트가 RED인지 확인한다**

Run: `pnpm exec vitest run tests/unit/required-option-text-validation.test.ts`

Expected: FAIL because the validation module does not exist.

- [ ] **Step 7: 순수 검증 모듈을 구현한다**

```ts
export interface RequiredOptionTextIssues {
  questionMissing: boolean;
  cellIds: string[];
}

export function collectRequiredOptionTextIssues(
  question: Question,
  response: unknown,
  optionTexts: Record<string, string> | undefined,
): RequiredOptionTextIssues {
  const questionMissing = question.required === true
    ? hasMissingSelectedOptionText(question, response, optionTexts)
    : false;
  const cellIds = question.type === 'table'
    ? collectMissingRequiredCellOptionTexts(question, response, optionTexts)
    : [];
  return { questionMissing, cellIds };
}
```

일반 선택 옵션은 `collectSelectedOptionIds`와 `optionTexts[option.id]?.trim()`을 사용한다.
순위형은 선택된 `RankingAnswer.optionValue`의 옵션을 찾아 `optionText?.trim()`을 검사한다.
테이블 질문이 필수이면 내부 모든 선택형 셀의 선택된 상세기입 옵션도 질문 누락에 포함하고,
셀 누락 목록은 `cell.required === true`인 표시 대상 후보만 반환한다.

- [ ] **Step 8: 순수 검증 테스트와 타입 검사를 GREEN으로 확인한다**

Run:

```bash
pnpm exec vitest run \
  tests/unit/required-option-text-validation.test.ts \
  tests/integration/option-text-migration.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 9: 순수 검증 계약을 커밋한다**

```bash
git add \
  src/lib/survey/required-option-text-validation.ts \
  src/lib/option-text-migration.ts \
  tests/unit/required-option-text-validation.test.ts \
  tests/integration/option-text-migration.test.ts
git commit -m "feat: 옵션 상세기입 필수 검증 추가"
```

---

### Task 2: 필수 질문의 다음·완료 차단 연결

**Files:**

- Modify: `src/components/survey-response/survey-response-flow.tsx`
- Create: `tests/unit/survey-response/required-option-text-flow.test.tsx`

**Interfaces:**

- Consumes: `collectRequiredOptionTextIssues(question, response, optionTexts)`
- Consumes: `useSurveyResponseStore(state => state.optionTexts)`
- Preserves: 기존 `isQuestionAnsweredPure`, 필수 질문 하이라이트, 분기 경로 계산

- [ ] **Step 1: 필수 질문 진행 차단 테스트를 작성한다**

필수 radio 질문의 상세기입 옵션을 선택한 상태로 `optionTexts`를 빈 값과 공백 값으로
설정하고 “다음”을 누르면 페이지가 이동하지 않으며 질문 카드가 필수 누락으로
하이라이트되는 테스트를 작성한다. 같은 픽스처에서 유효한 텍스트를 입력하면 다음
페이지로 이동하는 테스트도 작성한다.

```tsx
useSurveyResponseStore.getState().setOptionText('q-required', 'opt-other', '   ');
await user.click(screen.getByRole('button', { name: '다음' }));
expect(screen.getByText('다음 페이지 질문')).not.toBeVisible();
expect(screen.getByTestId('question-q-required')).toHaveAttribute('data-required-error', 'true');
```

선택 사항 질문은 공백 상세기입으로도 이동 가능한 사례를 별도 테스트한다.

- [ ] **Step 2: 응답 흐름 테스트가 RED인지 확인한다**

Run: `pnpm exec vitest run tests/unit/survey-response/required-option-text-flow.test.tsx`

Expected: FAIL because current `isQuestionAnswered` only checks that the option was selected.

- [ ] **Step 3: 응답 흐름이 `optionTexts`를 반응형으로 구독하게 한다**

```ts
const optionTexts = useSurveyResponseStore((state) => state.optionTexts);

const isQuestionAnswered = useCallback(
  (question: Question) =>
    isQuestionAnsweredPure(question, responses[question.id]) &&
    !collectRequiredOptionTextIssues(
      question,
      responses[question.id],
      optionTexts[question.id],
    ).questionMissing,
  [responses, optionTexts],
);
```

`buildOptTextsPayload`의 기존 제출 필터와 응답 저장 형식은 변경하지 않는다. 이 콜백은
기존 `canProceed`, 필수 남은 개수, `useResponseLifecycle.handleSubmit`에 그대로 전달되어
다음 이동과 완료를 함께 차단한다.

- [ ] **Step 4: 질문 진행 차단과 기존 흐름 회귀 테스트를 GREEN으로 확인한다**

Run:

```bash
pnpm exec vitest run \
  tests/unit/survey-response/required-option-text-flow.test.tsx \
  tests/unit/answer-validation.test.ts \
  tests/unit/use-response-lifecycle.test.tsx
```

Expected: PASS.

- [ ] **Step 5: 필수 질문 연결을 커밋한다**

```bash
git add \
  src/components/survey-response/survey-response-flow.tsx \
  tests/unit/survey-response/required-option-text-flow.test.tsx
git commit -m "feat: 필수 질문 상세기입으로 진행 차단"
```

---

### Task 3: 필수 선택형 셀의 기존 오류 UI 연결

**Files:**

- Modify: `src/lib/survey/numeric-validation.ts`
- Modify: `src/components/survey-response/survey-response-flow.tsx`
- Modify: `tests/unit/numeric-validation.test.ts`

**Interfaces:**

- Extends: `NumericValidationCtx.optionTexts?: Record<string, string>`
- Consumes: `collectRequiredOptionTextIssues(question, response, optionTexts).cellIds`
- Produces: 기존 `NumericIssue { kind: 'required-cells'; cellIds: string[] }`

- [ ] **Step 1: 필수 셀 상세기입 누락 테스트를 작성한다**

```ts
it('필수 radio 셀에서 선택한 상세기입 옵션이 공백이면 required-cells 이슈다', () => {
  const question = tableQuestion({
    cells: [{
      id: 'radio-cell',
      type: 'radio',
      required: true,
      radioOptions: [{
        id: 'other',
        value: 'other-value',
        label: '기타',
        allowTextInput: true,
      }],
    }],
  });
  expect(
    collectNumericIssues(
      question,
      { 'radio-cell': 'other-value' },
      { allResponses: {}, allQuestions: [question], optionTexts: { other: '   ' } },
    ),
  ).toContainEqual({
    kind: 'required-cells',
    message: '필수 응답이 비어있습니다',
    cellIds: ['radio-cell'],
  });
});
```

checkbox·select·ranking 셀, 유효 상세기입, 선택 사항 셀, 숨은 셀 사례도 추가한다.

- [ ] **Step 2: 필수 셀 테스트가 RED인지 확인한다**

Run: `pnpm exec vitest run tests/unit/numeric-validation.test.ts`

Expected: FAIL because `NumericValidationCtx` and `required-cells` do not inspect option text.

- [ ] **Step 3: 필수 셀 누락을 기존 이슈에 합친다**

```ts
export interface NumericValidationCtx {
  allResponses: Record<string, unknown>;
  allQuestions: Question[];
  optionTexts?: Record<string, string>;
}

const optionTextMissingIds = collectRequiredOptionTextIssues(
  question,
  cellValues,
  ctx?.optionTexts,
).cellIds;
const missingIds = [...new Set([...ordinaryMissingIds, ...optionTextMissingIds])]
  .filter((id) => visibleIds.has(id));
```

미선택 동적 행, 숨은 행·열, 병합 피복 셀은 기존 `visibleCells` 결과의 ID 집합으로
필터링한다. 동일 셀이 일반 미입력과 상세기입 누락을 동시에 위반해도 한 번만 반환한다.

- [ ] **Step 4: 응답 흐름에서 질문별 옵션 텍스트를 테이블 검증에 전달한다**

```ts
const issues = collectNumericIssues(q, responses[q.id], {
  allResponses: responses,
  allQuestions: questions,
  optionTexts: optionTexts[q.id],
});
```

`numericIssuesByQuestion`의 의존성에 `optionTexts`를 추가해 텍스트 입력 즉시 검증 결과가
갱신되게 한다.

- [ ] **Step 5: 필수 셀 및 테이블 회귀 테스트를 GREEN으로 확인한다**

Run:

```bash
pnpm exec vitest run \
  tests/unit/numeric-validation.test.ts \
  tests/unit/survey/table-range-banner-filter.test.tsx \
  tests/unit/survey-response/required-option-text-flow.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: 필수 셀 연결을 커밋한다**

```bash
git add \
  src/lib/survey/numeric-validation.ts \
  src/components/survey-response/survey-response-flow.tsx \
  tests/unit/numeric-validation.test.ts
git commit -m "feat: 필수 셀 상세기입으로 진행 차단"
```

---

### Task 4: 전체 검증

**Files:**

- Modify only if verification exposes a regression in the files above.

**Interfaces:**

- Consumes: 모든 이전 태스크 계약
- Produces: 승인된 상세기입 필수 검증 동작

- [ ] **Step 1: 기능 집중 테스트를 실행한다**

```bash
pnpm exec vitest run \
  tests/integration/option-text-migration.test.ts \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey-response/required-option-text-flow.test.tsx \
  tests/unit/numeric-validation.test.ts \
  tests/unit/answer-validation.test.ts \
  tests/unit/use-response-lifecycle.test.tsx \
  tests/unit/survey/table-range-banner-filter.test.tsx
```

Expected: PASS.

- [ ] **Step 2: 타입 검사와 범위 린트를 실행한다**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint --quiet \
  src/lib/option-text-migration.ts \
  src/lib/survey/required-option-text-validation.ts \
  src/lib/survey/numeric-validation.ts \
  src/components/survey-response/survey-response-flow.tsx
```

Expected: PASS.

- [ ] **Step 3: 전체 테스트를 실행한다**

Run: `pnpm test`

Expected: PASS. 문서화된 `profiles-row-actions.test.ts` 전체 스위트 간헐 실패가 발생하면
해당 파일을 격리 재실행해 실제 회귀와 구분한다.

- [ ] **Step 4: 최종 diff를 요구사항과 비교한다**

- 질문 또는 셀이 필수인 경우에만 상세기입을 강제한다.
- 선택된 `allowTextInput` 옵션만 검사한다.
- 공백만 있는 값은 미입력이다.
- 필수 질문과 필수 셀의 기존 오류 UI를 재사용한다.
- 숨은 질문·셀은 차단하지 않는다.
- 저장 형식, DB, export, 관련 없는 미커밋 변경은 건드리지 않는다.

- [ ] **Step 5: 검증 중 수정이 필요할 때만 커밋한다**

```bash
git commit -m "fix: 옵션 상세기입 필수 검증 회귀 수정"
```

수정이 없으면 빈 커밋을 만들지 않는다.
