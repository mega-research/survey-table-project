# 수동 페이지 구분점 (Manual Page Breaks) 설계

> 작성일: 2026-06-30
> 상태: 설계 확정 (구현 전)

## 1. 배경 / 문제

현재 응답 페이지의 페이지(스텝) 분할은 **자동 계산**이다. `src/lib/group-ordering.ts`의
`buildRenderSteps()`가 두 규칙으로 자른다:

1. **최상위 그룹(`question_groups`) 경계**마다 페이지를 나눈다.
2. **테이블형(`type === 'table'`) 질문**은 무조건 단독 페이지로 분리한다.

빌더에는 페이지를 직접 제어하는 UI가 없다. 운영자는 그룹 구조와 테이블 여부로만
간접적으로 페이지 구성을 바꿀 수 있어, 원하는 위치에서 페이지를 자를 수 없다.

## 2. 목표

설문 편집기에서 **페이지를 자르는 구간(구분점)을 직접 선택**할 수 있게 한다.

### 확정된 설계 결정 (사용자 합의)

- **순수 수동 모델**: 페이지는 오직 수동 구분점으로만 결정된다. 그룹 경계 자동 분할,
  테이블 단독 분할을 **모두 제거**한다. 그룹은 순서/계층/헤더 표시 용도로만 남는다.
- **자동 시드 없음**: 마이그레이션 시 기존 자동 분할 결과를 구분점으로 심지 않는다.
- **구분점 0개 = 한 페이지**: 구분점이 없는 설문(기존 발행 설문 포함)은 모든 질문이
  한 페이지에 표시된다 (완전 WYSIWYG).
- **기존 발행 설문**: 별도 마이그레이션 도구 없이 그냥 한 페이지로 둔다. 운영자가
  필요하면 구분점을 직접 찍는다.
- **페이지 헤더**: 지금처럼 헤더를 유지하되, 페이지에 들어간 질문들의 **그룹 이름**을
  헤더/소제목으로 표시한다 (그룹은 페이지 경계가 아니라 헤더 출처가 된다).

## 3. 비목표 (YAGNI)

- 자동 시드 / "구분점 자동 채우기" 버튼 — 만들지 않는다.
- 발행 버전별 페이지 모델 분기 — 만들지 않는다 (단일 모델).
- 페이지별 커스텀 제목 입력 — 만들지 않는다 (헤더는 그룹 이름에서 파생).
- 페이지 미리보기 전용 화면 — 빌더 리스트의 디바이더로 충분.

## 4. 설계

### 4.1 데이터 모델 — `pageBreakBefore` 플래그

페이지 구분점을 **질문의 boolean 필드** `pageBreakBefore`로 표현한다.
의미: "이 질문 앞에서 새 페이지를 시작한다."

근거:
- 질문에 붙어 있어 **DnD 이동/복제 시 구분점이 함께 따라간다**. 별도의 위치 인덱스
  배열을 관리할 필요가 없어 구조 변경 시 어긋남(stale anchor) 버그가 생기지 않는다.
- 전체 선형 질문열의 **첫 질문**에 붙은 `pageBreakBefore`는 무시한다 (이미 페이지 시작).

추가/수정 지점:
- `src/db/schema/question-persisted-fields.ts` — `PERSISTED_QUESTION_FIELDS`에 등재.
  등재만 하면 TypeScript가 4개 완전 쓰기 지점을 컴파일 에러로 호명한다:
  - `survey-save.service.ts` (upsert)
  - `questions.service.ts` create / updateQuestion 순회
  - `surveys.service.ts` duplicateSurvey
- `src/db/schema/surveys.ts` — `questions` 테이블에 `page_break_before boolean default false` 컬럼.
- `src/types/survey.ts` — `Question`에 `pageBreakBefore?: boolean`.
- Create/Update input 타입(`features/survey-builder/domain` 또는 해당 question input zod)에 필드 추가.
- 마이그레이션: `pnpm db:generate` → 새 컬럼 추가 (default false).
- **스냅샷 검증**: `survey_versions.snapshot`은 질문 객체를 통째로 저장하므로
  `pageBreakBefore`가 자동 포함되는지 확인한다. 발행 설문의 응답 페이지는 스냅샷을
  읽으므로 이 필드가 스냅샷에 들어가야 일관된다.

### 4.2 분할 엔진 — `buildRenderSteps` 재작성

`group-ordering.ts`의 순서/계층 로직은 **그대로 재사용**한다:
`getInterleavedChildren()`, `flattenRootScope()`는 변경하지 않는다 (질문 선형 순서와
그룹 계층은 동일하게 계산).

바꾸는 것은 "어디서 자르냐"뿐이다.

- 제거: 최상위 그룹 경계 분할 + `splitByTable()`.
- 신규 흐름:
  1. 모든 최상위 그룹(order 순) + ungrouped를 이어 **하나의 선형 `StepItem[]`**로 평탄화.
     각 항목은 그룹 컨텍스트(root 그룹 id/이름/`nameDesign`, subgroup 이름)와
     "그룹 전환 여부" 마커를 가진다.
  2. 인덱스 0 그리고 `question.pageBreakBefore === true`인 항목마다 새 페이지를 시작.
  3. 각 페이지 = `RenderStep`.

`RenderStep` 타입을 **단일 종류 `page`로 통합**한다:

```typescript
export type RenderStep = {
  kind: 'page';
  items: StepItem[]; // 1개 이상
};

export type StepItem = {
  question: Question;
  // 헤더 렌더용 그룹 컨텍스트
  rootGroupId: string | null;
  rootGroupName: string | null;        // hideName이면 null
  rootGroupNameDesign?: GroupNameDesign;
  subgroupName: string | null;
  startsRootGroup: boolean;            // 직전 항목과 root 그룹이 달라짐
  startsSubgroup: boolean;             // 새 하위그룹 시작
};
```

(테이블은 더 이상 별도 `kind`가 아니라 페이지 안의 한 `StepItem`이다.)

`stepIdOf()`:

```typescript
export function stepIdOf(step: RenderStep): string {
  return `page:${step.items[0].question.id}`; // 구조적 anchor
}
```

분기 영향 없음: `BranchRule`은 `targetQuestionId`를 타겟으로 하고
`resolveStepBranch()` → `findStepIndexOfQuestion()`이 "그 질문이 들어있는 페이지"를
인덱스로 변환한다. 페이지를 어떻게 자르든 분기는 그대로 동작한다.
`findStepIndexOfQuestion()`은 새 `page` 구조(`step.items`)를 순회하도록 갱신한다.

### 4.3 응답 페이지 렌더 — `PageStepView`로 통합

현재 `survey-response-flow.tsx`의 `kind === 'table' ? <TableStepView> : <GroupStepView>`
2분기를 **단일 `PageStepView`**로 합친다.

- 페이지의 `items`를 순서대로 렌더. 일반 질문은 기존 `group-step-item` 렌더를,
  테이블 질문은 기존 테이블 렌더(모바일 드릴다운 포함)를 **그대로 위임 재사용**한다.
  → 기존 `TableStepView` 내부 렌더 로직은 단일 테이블 항목 렌더러로 추출해 재사용.
- **그룹 이름 헤더**:
  - 페이지 안에서 root 그룹이 바뀌는 지점(`startsRootGroup`)마다 그룹 이름 헤더 표시.
  - `startsSubgroup`마다 하위그룹 소제목 표시 (기존 subgroupName 표시 방식).
  - **페이지 첫 항목**은 (그룹 전환이 아니어도) 현재 속한 그룹 헤더를 다시 표시해
    맥락을 유지한다.
  - `hideName` 그룹은 헤더 미표시 (기존 동작 유지).
- **컨테이너 너비**: 페이지에 테이블 질문이 하나라도 있으면 wide(`max-w-7xl`),
  아니면 `max-w-4xl`.
- `getDisplayableItemsOfStep()` 등 표시조건 필터는 단일 `page` 구조에 맞춰 단순화.

### 4.4 빌더 UI — 질문 사이 구분점 토글

`src/components/survey-builder/sortable-question-list.tsx`에서 질문 카드 **사이**에
페이지 구분 디바이더를 렌더한다.

- 질문 사이 간격에 "여기서 페이지 나누기" 토글(추가/제거). 켜면 아래 질문의
  `pageBreakBefore = true`로 `updateQuestion`.
- 구분점이 켜진 위치는 **굵은 디바이더 + 라벨**로 강조 → 빌더에서도 페이지 경계가
  WYSIWYG로 보인다.
- 전체 선형 순서상 첫 질문 위에는 토글을 숨긴다 (의미 없음).
- DnD 정렬(dnd-kit)은 그대로. 구분점은 질문 필드라 정렬과 독립적으로 따라간다.

### 4.5 운영 콘솔 / 스텝 ID

`currentStepId` 포맷이 `group:<id>` / `table:<id>` → `page:<questionId>`로 바뀐다.
영향 파일:

- `features/survey-response/server/services/lifecycle.service.ts` — `recordStepVisit` 저장값.
- `lib/operations/profiles.ts` — `buildStepLocationMap` 역매핑 (`page:<qid>` → 질문 order/번호).
- `lib/operations/drop-funnel.server.ts` — `page_visits` stepId 추출/집계.
- `lib/operations/page-dwell.ts` — `buildCanonicalSteps` 호환.
- `db/schema/surveys.ts` — `currentStepId` 컬럼 주석 갱신.

**레거시 호환**: 과거 응답의 `page_visits`/`currentStepId`에는 `group:`/`table:`
문자열이 남아 있다. 역매핑/펀넬 파싱은 이들을 **크래시 없이 폴백 처리**한다
(미상 위치로 무시하거나 best-effort 매핑). 신규 응답만 `page:` 포맷을 쓴다.

## 5. 마이그레이션 영향

- 기존 발행 설문: 구분점이 없으므로 **한 페이지로 합쳐진다**. 별도 도구 없이 그대로 둔다.
  운영자가 필요 시 빌더에서 구분점을 직접 찍는다. (사용자 합의)
- 운영 콘솔 과거 펀넬 데이터: 레거시 stepId 폴백으로 깨지지 않게 처리.

## 6. 테스트 전략 (TDD)

- `buildRenderSteps` 단위 테스트:
  - 구분점 0개 → 페이지 1개(모든 질문 + 테이블 한 페이지).
  - `pageBreakBefore`가 찍힌 질문에서만 분할.
  - 첫 질문의 `pageBreakBefore`는 무시.
  - 페이지가 그룹 경계를 가로질러도 그룹 헤더 컨텍스트가 항목에 올바로 주석된다.
- `stepIdOf` → `page:<firstQuestionId>` 포맷.
- `findStepIndexOfQuestion` / `resolveStepBranch` 분기 점프가 새 구조에서 동작.
- 빌더: 구분점 토글이 `pageBreakBefore`를 set/unset.
- 운영 콘솔: 레거시 `group:`/`table:` stepId 폴백 파싱 회귀 테스트.

## 7. 영향 파일 요약

| 영역 | 파일 |
|------|------|
| 스키마/타입 | `db/schema/question-persisted-fields.ts`, `db/schema/surveys.ts`, `types/survey.ts`, question input zod |
| 쓰기 지점 | `survey-save.service.ts`, `questions.service.ts`, `surveys.service.ts` |
| 분할 엔진 | `lib/group-ordering.ts` (`buildRenderSteps`, `RenderStep`, `stepIdOf`, `findStepIndexOfQuestion`) |
| 응답 렌더 | `survey-response-flow.tsx`, `step-views/`(신규 `PageStepView`, 기존 group/table view 통합) |
| 빌더 UI | `sortable-question-list.tsx` (구분점 디바이더) |
| 운영 콘솔 | `lib/operations/profiles.ts`, `drop-funnel.server.ts`, `page-dwell.ts`, `lifecycle.service.ts` |
