# 테이블 렌더링 radio/checkbox 질문 (Case A) — 설계

작성일: 2026-06-01
브랜치: `feature/table-choice-questions`

## 문제

클라이언트 요구로 단순 radio/checkbox 위젯으로는 만들 수 없고, **설명 목록(정의·예시·이미지 등)을 테이블로 띄운 뒤 한 열의 셀을 선택지로** 써야 하는 질문이 있다. 예: "귀사가 보유 중인 인공지능 기술 분야를 모두 선택해 주세요" — 행 = 기술분야, 열 = `기술분야 / 세부분류예시 / 선택`, `선택` 열의 셀이 체크박스.

본질은 **깨끗한 단일 변수(체크박스/라디오)** 인데, 현재 이런 질문을 `type='table'` 로 우회 제작하면 응답이 테이블 응답 구조로 저장돼 **분석/SPSS export 가 지저분**해진다. (저작 효율이나 응답 UX 문제가 아니라 데이터 모델 문제.)

### 범위 분리 (decompose)

이 문제는 두 시나리오로 나뉜다. 본 스펙은 **Case A 만** 다룬다.

- **Case A — 질문 = 논리변수 1개, 테이블은 표시용** ← 본 스펙
  타입을 `radio`/`checkbox` 로 유지 + 테이블 내장. 응답은 옵션 기반 저장 → 분석/export 가 일반 radio/checkbox 처럼 처리.
- **Case B — `type='table'` 유지, 내부에 radio/checkbox/ranking 셀 그룹 N개 공존** (별도 작업)
  `1 질문 = N 변수`. 기존 `TableCell.radioGroupName` + 미착수 MRSETS 플랜(`~/.claude/plans/wobbly-prancing-sun.md`)에 흡수.

## 접근

순위형(ranking) Case 2 가 **완전히 동일한 패턴**을 이미 구현해 두었다: `rankingConfig.optionsSource = 'manual' | 'table'`, `TableCell.type = 'ranking_opt'`, 옵션 소스 추상화 `src/utils/ranking-source.ts`, 그리고 builder/response/analyzer/spss 전반의 연동. **이를 radio/checkbox 용으로 미러링**한다.

### 순위형과의 차이 (중요)

순위형은 `ranking_opt` 셀 **자체에 옵션 텍스트(content)** 가 들어있다. 반면 Case A 의 `선택` 열 셀은 **비어 있고**, 사람이 읽는 라벨("컴퓨터 비전")은 **같은 행의 다른 열 셀**에 있다. 따라서 옵션 라벨을 셀 `content` 가 아니라 **명시적 `exportLabel` 필드**에서 가져온다 (작성자가 선택 셀에 분석용 라벨을 입력).

### 대안과 트레이드오프

- (채택) 순위형 미러링 — 임의의 리치 테이블 레이아웃 가능, 검증된 인프라 재사용, 데이터 모델 깨끗.
- (기각) `QuestionOption` 에 `description`/`imageUrl` 필드 추가 후 자동 표 렌더 — 임의 열 구성·병합셀·다열 설명 불가. 클라 요구 미충족.
- (기각) 범용 행↔옵션 매핑 레이어 — Case B 와 겹치고 과도.

## MVP 범위

table 렌더링 radio/checkbox 는 **일반 radio/checkbox 와 기능 동등성**을 가진다. 아래 모두 포함:

1. **옵션별 분기(branchRule)** — radio 분기는 핵심 기능. 순위형 Case 2 의 "분기 미지원" 한계(`branch-logic.ts:124`)는 그대로 물려받지 않는다. 분기 매칭은 `cell.id` 기준: 셀에 붙은 `branchRule.value` = 해당 셀의 `cell.id`(자기참조), 응답 값도 `cell.id` 이므로 branch-logic 이 `resolveChoiceOptions` 를 경유하면 정상 매칭된다.
2. **기타(직접입력) 셀** — `isOtherRankingCell` 의 복제(`isOtherChoiceCell`).
3. **옵션별 사이드카 텍스트** — `QuestionOption.allowTextInput` 패턴. SPSS `_text` 변수 자동 생성.
4. **검증 규칙(min/max 선택)** — checkbox 의 `question.minSelections/maxSelections` 를 table 소스에서도 동작.

## 데이터 모델

### Question (`src/types/survey.ts`)

```ts
// radio/checkbox 전용. 'table' 이면 tableRowsData 의 choice_opt 셀이 옵션 소스.
// (순위형은 rankingConfig.optionsSource 를 계속 사용 — 마이그레이션 불필요)
optionsSource?: 'manual' | 'table';
```

radio/checkbox 도 이미 `tableColumns` / `tableRowsData` / `optionsColumns` / `minSelections` / `maxSelections` 를 들고 있으므로 추가 필드는 `optionsSource` 뿐이다.

### TableCell — 새 셀 타입 `choice_opt`

`TableCell.type` 유니온에 `'choice_opt'` 추가. 질문 타입이 `radio` 면 단일선택, `checkbox` 면 복수선택 (셀 타입 자체는 1개).

`choice_opt` 셀이 사용하는 필드:

| 용도 | 필드 | 상태 |
| --- | --- | --- |
| 분석/SPSS 라벨 | `exportLabel` | 기존 재사용 |
| 옵션 코드 | `optionCode` | 기존 재사용 |
| SPSS 숫자코드 | `spssNumericCode` | 기존 재사용 |
| 옵션별 분기 | `branchRule?: BranchRule` | **신규 (TableCell 에 추가)** |
| 기타 직접입력 셀 | `isOtherChoiceCell?: boolean` | **신규** |
| 사이드카 텍스트 | `allowTextInput?`, `textInputPlaceholder?` | **신규 (TableCell 에 추가)** |

`branchRule` / `allowTextInput` / `textInputPlaceholder` 는 현재 `RadioOption`/`CheckboxOption`/`QuestionOption` 에만 있고 `TableCell` 에는 없다 → `resolveChoiceOptions` 가 셀→QuestionOption 매핑 시 그대로 옮길 수 있도록 셀에 추가한다.

## 옵션 소스 추상화 — `src/utils/choice-source.ts` (신규)

`ranking-source.ts` 와 동형.

```ts
export function collectChoiceOptCells(tableRowsData?: TableRow[]): TableCell[]
// type === 'choice_opt' && !isHidden 인 셀을 순서대로 수집

export function resolveChoiceOptions(question: Question): QuestionOption[]
// optionsSource !== 'table'  → question.options ?? []
// optionsSource === 'table'  → choice_opt 셀 매핑:
//   id/value     = cell.id (UUID, 셀 이동/라벨 변경에 강건)
//   label        = exportLabel > content > '(라벨 없음)'
//   optionCode   = cell.optionCode
//   spssNumericCode = cell.spssNumericCode ?? idx + 1
//   branchRule   = cell.branchRule
//   allowTextInput / textInputPlaceholder = cell.*
//   isOtherChoiceCell=true 셀 → value = CHOICE_OTHER_VALUE (기타 자유입력)
```

옵션 목록이 필요한 모든 소비처(analyzer, spss, branch-logic, 응답 렌더, 검증)는 `question.options` 를 직접 읽는 대신 `resolveChoiceOptions(question)` 를 호출하도록 전환한다.

## 빌더 UX

- `question-basic-tab.tsx`: radio/checkbox 일 때 "테이블로 표시" 토글 노출 → `optionsSource='table'`. 켜지면 수동 옵션 입력 UI 숨기고 내장 테이블 에디터 노출. (순위형 `optionsSource==='table'` 분기 — `question-basic-tab.tsx:126~131` — 와 동일 패턴으로 조건 확장.)
- `question-edit-modal.tsx`: 저장 검증에서 table 소스 radio/checkbox 는 manual 옵션 검증 스킵 (순위형 `question-edit-modal.tsx:198~200` 패턴). 대신 "choice_opt 셀이 1개 이상" 검증.
- `cell-content-modal.tsx`: `choice_opt` 셀 편집 탭 추가. `ranking-opt-cell-tab.tsx` 를 본떠 `choice-opt-cell-tab.tsx` 신규 — 라벨(`exportLabel`)/코드/spss/분기/사이드카텍스트/기타셀 입력.
- 기타(직접입력) 셀 질문당 1개 강제: `hasExistingOtherRankingCell` 패턴을 `choice-source.ts` 에 동형 추가.

## 응답 렌더 & 저장

- radio/checkbox 응답 컴포넌트가 `optionsSource==='table'` 이면 `interactive-table-response` 류의 테이블 레이아웃으로 렌더하고 `선택` 열 셀에 radio/checkbox input 을 그린다. (순위형 `ranking-question.tsx` 의 `isTableSource` 분기와 동형.)
- 응답은 **일반 radio/checkbox 와 동일한 shape** 로 저장:
  - radio → 단일 값 (`= 선택된 choice_opt 셀의 cell.id`)
  - checkbox → 값 배열 (`= [cell.id, ...]`)
- min/max, required, 기타 자유입력, 사이드카 텍스트 모두 일반 radio/checkbox 응답 경로와 동일 검증.

## 분석 · SPSS export

- 응답 shape 가 일반 radio/checkbox 와 동일하므로 **집계 로직 자체는 무수정**.
- 옵션 메타(라벨/코드/spss)만 `resolveChoiceOptions` 를 경유하도록 analyzer / spss-excel-export / sav-builder 의 옵션 조회 지점을 어댑터로 교체. (순위형이 `resolveRankingOptions` 로 한 것과 동일.)
- 사이드카 텍스트 → `{var}_{n}_text` STRING 변수, 기타 셀 → `_etc` 처리: 순위형/일반 옵션의 기존 처리 경로 재사용.

## 마이그레이션

- 신규 필드는 모두 optional → 기존 데이터/스냅샷 영향 없음.
- 기존에 `type='table'` 로 우회 제작된 질문을 자동 변환하지 **않는다** (수동 재작성 또는 Case B 에서 별도 처리). 본 스펙은 신규 작성 경로만 제공.

## 테스트

- `tests/` 에 `choice-source` 단위 테스트: manual / table 소스, 기타 셀, isHidden 제외, spssNumericCode 폴백.
- 응답 저장 shape 가 일반 radio/checkbox 와 동일함을 검증하는 integration 테스트.
- branch-logic 이 table 소스 옵션의 `branchRule` 을 평가하는지 검증.
- (참고: `tests/` 디렉토리만 vitest include. src 옆 `*.test.ts` 는 silent skip.)

## 알려진 비목표 (Non-goals)

- Case B (테이블 내부 다중 논리그룹 / MRSETS).
- 기존 table 질문의 자동 마이그레이션.
- select/multiselect 의 table 소스화 (필요 시 후속).
