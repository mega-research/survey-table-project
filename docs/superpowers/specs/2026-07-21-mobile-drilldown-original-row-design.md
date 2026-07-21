# 모바일 드릴다운 + 선택 행 원본 렌더링 — 설계

> 작성일: 2026-07-21
> 상태: 설계 확정, 구현 계획 대기

## 배경 / 문제

테이블 질문의 현재 모바일 표시 방식은 두 가지다.

1. 기본값: `MobileTableDrilldown` 또는 `MobileTableStepper`가 표를 카드형 입력 UI로 변환한다.
2. `mobileOriginalTable=true`: 데스크톱 원본 표 전체를 모바일에서도 가로 스크롤로 유지한다.

5점·10점 척도처럼 **열의 순서와 헤더-응답 대응 관계**가 중요한 표는 카드형 상세 화면에서
척도의 시각적 연속성이 사라진다. 반대로 원본 표 전체를 보여주면 항목 열과 여러 행이 한꺼번에
노출되어 모바일 탐색이 불편하다.

원하는 흐름은 두 방식의 장점을 결합한 것이다.

- 첫 진입: 기존 드릴다운의 항목/행 카드 목록을 그대로 사용한다.
- 카드 진입: 선택한 행 한 개만 원본 표 형태로 렌더한다.
- 상세 표: 첫 번째 가시 열은 제외한다. 이 열의 항목명은 이미 드릴다운 카드와 상세 제목에서
  표시되므로 반복하지 않는다.
- 척도 헤더와 라디오·체크박스·기타 입력 셀은 한 줄을 유지하고 기존 가로 스크롤 수단으로 이동한다.

적용 대상은 다음 두 경우다.

- `type='table'` 질문
- `radio`/`checkbox` 질문의 “설명 테이블로 보기” 구성

## 목표

1. 질문별 새 모바일 표시 옵션으로 “드릴다운 + 선택 행 원본” 모드를 제공한다.
2. 기존 드릴다운 목차, 뒤로/다음 이동, 진행 상태 및 응답 저장 로직을 최대한 재사용한다.
3. 상세 원본 행에서 첫 번째 **가시 논리 열**을 제외하고 나머지 헤더·셀의 정렬을 보존한다.
4. 다단 헤더, colspan/rowspan, 조건부 가시 열, 동일 행 라디오 그룹을 깨뜨리지 않는다.
5. 데스크톱 렌더, 응답 저장 shape, 분석/SPSS/엑셀 export를 변경하지 않는다.

## 비목표

- “10점 척도”를 셀 개수나 라벨로 자동 판별하지 않는다.
- 점수 버튼·슬라이더 같은 척도 전용 응답 컴포넌트를 새로 만들지 않는다.
- `ranking` 내장 설명 테이블에는 이번 모드를 적용하지 않는다.
- 첫 번째 열 이외의 열을 사용자가 임의로 숨기는 별도 매핑 UI는 만들지 않는다.
- 모바일 한 화면 안에 모든 척도 열을 강제로 축소해 넣지 않는다. 한 줄 의미를 보존하고 가로 이동을 허용한다.

## 선택한 접근

### 접근 A — 기존 드릴다운 + 선택 행 원본 렌더러 (채택)

기존 탐색 상태와 분류 결과를 유지하고 상세 렌더링만 새 공통 `OriginalRowTable` 계열 컴포넌트로
교체한다. 원본 헤더·셀 그리드, `InteractiveCell`, 선택형 질문의 기존 `renderCell`, 가로 스크롤
컨트롤을 재사용한다.

장점:

- 사용자가 익숙한 모바일 목차·진척도 흐름을 보존한다.
- 응답 로직과 데이터 shape를 재작성하지 않는다.
- 동적 테이블에서도 척도 의미를 하드코딩하지 않는다.

### 접근 B — 원본 표 전체 유지 (기존 기능, 미채택)

구현은 가장 작지만 항목 탐색 문제가 그대로 남는다. 이번 요구의 “행별 진입”을 만족하지 않는다.

### 접근 C — 척도 전용 모바일 컴포넌트 (미채택)

0~10 점수 버튼 등으로 화면 안에 압축할 수 있으나 테이블 셀 타입, 병합 헤더, 라디오 그룹 및
조건부 열 로직을 중복 구현하게 된다. 동적 테이블의 범용성을 훼손하므로 채택하지 않는다.

## 1. 설정 모델과 빌더 UI

### 1.1 영속 필드

기존 `mobileOriginalTable`을 유지하고 질문 컬럼을 하나 추가한다.

```ts
mobileDrilldownOriginalRow?: boolean;
```

- 기본값 `false`.
- `questions.mobile_drilldown_original_row boolean default false` 컬럼을 추가한다.
- `Question`, DB schema type, survey-builder zod 입력, `PERSISTED_QUESTION_FIELDS`, 생성·저장·복제
  채널에 포함한다.
- 배포 스냅샷에는 기존 질문 직렬화 경로를 통해 포함된다.

새 필드를 별도 boolean으로 두는 이유는 기존 `mobileOriginalTable=true` 설문을 데이터 마이그레이션
없이 그대로 보존하기 위해서다. UI와 런타임에서는 두 boolean을 직접 해석하지 않고 다음 단일
모드로 정규화한다.

```ts
type MobileTableDisplayMode = 'auto' | 'drilldown-original-row' | 'original';
```

해석 우선순위:

1. `mobileOriginalTable === true` → `original`
2. 아니고 `mobileDrilldownOriginalRow === true` → `drilldown-original-row`
3. 둘 다 아니면 → `auto`

오염 데이터에서 두 값이 모두 true여도 기존 명시 동작인 원본 표를 우선하여 회귀를 막는다.

### 1.2 편집 UI

`DynamicTableEditor`의 현재 “모바일에서 원본 표로 보기” 단일 토글을 **모바일 표시 방식** 선택으로
교체한다.

- 자동 카드: 두 boolean 모두 false
- 드릴다운 + 선택 행 원본: `mobileDrilldownOriginalRow=true`, `mobileOriginalTable=false`
- 원본 표: `mobileOriginalTable=true`, `mobileDrilldownOriginalRow=false`

세 선택은 UI에서 상호 배타적이다. 새 모드는 현재 편집 중인 질문이 다음 중 하나일 때만 노출한다.

- `type='table'`
- `type='radio' | 'checkbox'`이고 설명 테이블 모드(`tableColumns`/`tableRowsData`)가 활성화됨

`ranking`에서는 노출하지 않는다. 저장 직전 store 최신값을 form data에 합치는 기존
`mobileOriginalTable` 경로에 새 필드도 함께 포함한다.

## 2. 공통 선택 행 투영

새 순수 유틸은 런타임에서 이미 조건 필터가 끝난 `visibleColumns`, `visibleHeaderGrid`, 전체
`displayRows`, 선택 행 ID를 받아 상세 표 조각을 만든다.

```ts
projectMobileOriginalRow({
  visibleColumns,
  visibleHeaderGrid,
  displayRows,
  selectedRowId,
  omitLeadingVisibleColumns: 1,
})
```

규칙:

1. **첫 번째 저장 열이 아니라 첫 번째 가시 논리 열**을 제외한다.
2. 나머지 열 ID 집합과 **전체 displayRows**를 `recalculateColspansForVisibleColumns`에 전달하여 행 셀,
   colspan 및 다단 헤더 colspan을 함께 재계산한다. 전체 행을 먼저 투영해야 앞 행의 병합 시작 셀과
   continuation 관계를 잃지 않는다.
3. 재계산 결과에서 선택 행 하나를 꺼낸다. 항목명은 투영 전에 드릴다운 라벨로 확보한다.
4. 한 행만 렌더하므로 본문 셀의 `rowspan`은 1로 정규화한다. 다단 헤더 자체의 rowspan은 유지한다.
5. 제외 후 표시 가능한 인터랙티브 셀이 없으면 원본 행 렌더 대신 기존 카드 상세로 폴백한다.

단순 `columns.slice(1)`/`row.cells.slice(1)`만 사용하지 않는다. 병합 시작 셀이 제거되거나 다단
헤더가 첫 열을 가로지를 때 continuation/colspan 정합성이 깨질 수 있기 때문이다.

## 3. 공통 원본 행 렌더러

원본 표 렌더링에서 다음 부분을 공통 컴포넌트로 추출한다.

```ts
interface OriginalRowTableProps {
  columns: TableColumn[];
  row: TableRow;
  headerGrid?: HeaderCell[][];
  hideColumnLabels: boolean;
  renderCell: (cell: TableCell, context: CellContext) => ReactNode;
}
```

책임:

- 기존 `HeaderCells`의 다단/단일 헤더 렌더
- `table-grid-utils`의 열 너비·grid template·ARIA 속성
- 기존 `TableScrollControls`와 `useHorizontalScrollIndicators`
- 헤더/바디 `scrollLeft` 동기화
- 한 개 행의 원본 셀 경계·정렬·colspan 렌더
- 오류 셀 ring 및 `data-cell-id` 유지

비책임:

- 드릴다운 상태와 목차
- 응답 shape 해석
- 어떤 열을 제외할지 결정

이를 통해 `table`과 설명 테이블 선택형이 동일한 헤더/행 레이아웃을 사용하면서, 실제 입력 렌더러만
각 도메인의 기존 로직을 주입한다.

## 4. `type='table'` 응답 흐름

`InteractiveTableResponse`는 정규화한 모바일 표시 모드를 `MobileTableDrilldown`에 전달한다.

- `auto`: 현재 카드/드릴다운 동작 유지
- `original`: 현재 전체 원본 표 동작 유지
- `drilldown-original-row`: 첫 화면과 중간 리프 목록은 현재 `MobileTableDrilldown` 그대로 유지하고,
  `nav.leaf !== null` 상세에서 `OriginalRowTable`을 렌더

상세 입력은 기존 `InteractiveCell`을 그대로 사용한다. 동일 행·동일 `radioGroupName` 셀은 기존
`resolveRadioGroupProps` 로직을 공용 유틸로 이동하여 공통 HTML `name`과 sibling clear를 보존한다.

항목 라벨은 `ClassifiedLeaf.label`을 breadcrumb와 상세 제목에 사용한다. 해당 라벨이 들어 있던 첫
가시 열은 상세 원본 표에서 제외한다.

### 진행 상태

척도 행에서 여러 radio 셀이 하나의 `radioGroupName`을 공유하면 그 그룹 전체를 **응답 단위 1개**로
계산한다. 한 셀을 선택하면 해당 단위가 완료된다. 그룹 없는 input/select/radio/checkbox 셀은 기존처럼
각 셀을 한 단위로 계산한다.

이 규칙은 새 모드의 진행 표시와 다음 항목 이동 시 완료 판정에만 적용하며 저장 데이터는 바꾸지 않는다.

## 5. `radio`/`checkbox` 설명 테이블 흐름

`ChoiceTableResponse`의 새 모바일 분기는 기존 카드 탭의 의미를 다음처럼 바꾼다.

1. 첫 화면: 행별 드릴다운 카드 목록
2. 카드 탭: 선택하지 않고 해당 행 상세로 이동
3. 상세 원본 행의 `choice_opt` 라디오/체크박스 탭: 실제 응답 선택
4. 뒤로/다음 항목: 기존 드릴다운과 같은 탐색

실제 선택·해제는 현재 `ChoiceTableResponse`의 다음 로직을 그대로 주입한다.

- `getChoiceCellState`
- `toggle`
- grouped choice의 `getGroupKeyOfCell` / `getGroupTypeOfCell`
- `OptionTextInput`
- min/max 선택 카운터

첫 화면 카드는 선택 여부를 표시하지만 카드 전체 탭으로 값을 변경하지 않는다. radio 질문은 선택된 행
1개, checkbox 질문은 선택된 여러 행을 표시한다. 진행률 대신 선택형 질문의 기존 선택 카운터와
min/max 안내를 유지한다.

행 제목 우선순위는 현재 모바일 카드와 동일하게 유지한다.

1. `mobileDisplay='header'` 셀 내용
2. `choice_opt`의 resolved option label
3. `(라벨 없음)` 폴백

## 6. 데이터 흐름

```text
빌더 모바일 표시 선택
  → question.mobileOriginalTable / mobileDrilldownOriginalRow
  → 저장·publish snapshot
  → 응답 페이지에서 mode 정규화
     ├─ auto: 기존 모바일 카드/드릴다운
     ├─ original: 기존 전체 원본 표
     └─ drilldown-original-row
          → 기존 행/섹션 목차
          → 선택 row + 첫 가시 열 제외 투영
          → 공통 OriginalRowTable
             ├─ table: InteractiveCell
             └─ 설명 테이블: ChoiceTableResponse renderCell
```

응답 키는 기존 `cell.id`를 그대로 사용한다. 분석, 분기 로직, 정규화, export에는 변경이 없다.

## 7. 오류·엣지 케이스

1. **열이 1개뿐임**: 첫 가시 열 제외 후 빈 표가 되므로 기존 카드 상세로 폴백한다.
2. **첫 열이 조건으로 숨겨짐**: 조건 평가 후 첫 번째 가시 열을 제외한다.
3. **첫 열이 colspan 시작 셀**: 공용 재계산 유틸로 남은 colspan과 continuation을 복구한다.
4. **다단 헤더**: 제외된 열 수만큼 각 헤더 셀 colspan을 재계산하고 빈 헤더 행을 제거한다.
5. **행 displayCondition/동적 행**: 기존 `displayRows`를 입력으로 쓰므로 숨은 행은 목차와 상세 모두 미노출이다.
6. **동일 행 radio 그룹**: 공통 name + sibling clear로 단일 선택을 유지한다.
7. **Case A 카드 탭**: 탐색 전용이다. 실제 선택은 상세 행의 입력에서만 발생한다.
8. **두 모바일 boolean이 모두 true**: `original` 우선.
9. **응답 페이지 snapshot**: publish 전 빌더 변경은 공개 응답에 반영되지 않는 기존 규칙을 유지한다.

## 8. 변경 범위

예상 주요 변경:

| 영역 | 변경 |
|---|---|
| DB·타입 | `mobileDrilldownOriginalRow` 컬럼·타입·zod·SSOT·마이그레이션 |
| 빌더 | 모바일 표시 방식 3개 선택, 저장 직전 store 병합 |
| 공통 유틸 | 모바일 모드 정규화, 첫 가시 열 제외 행 투영, radio 그룹 props |
| 공통 UI | 원본 한 행 헤더/바디/스크롤 렌더러 |
| table 응답 | 기존 드릴다운 상세에서 새 원본 행 렌더 분기 |
| Case A 응답 | 행 목차 → 상세 원본 행 탐색 분기, 기존 toggle 주입 |

## 9. 테스트 전략

### 순수 유틸

- 모드 정규화 3종 및 두 boolean 동시 true 우선순위
- 첫 가시 열 제외
- 첫 열 조건 숨김 후 다음 가시 열 제외
- colspan/rowspan 및 다단 헤더 재계산
- 제외 후 인터랙티브 셀 없음 폴백
- 동일 `radioGroupName`을 진행 단위 하나로 계산

### `type='table'`

- 새 모드 첫 진입 시 기존 드릴다운 목차 표시
- 행 카드 탭 후 첫 열 항목명이 상세 제목에는 있고 원본 grid에는 없음
- 헤더와 0~10 입력 셀이 한 줄·동일 scrollLeft로 이동
- radio 한 개 선택 시 sibling 응답 clear 및 행 완료 처리
- 뒤로/다음 항목/전체 진행 상태 유지
- auto/original 기존 분기 회귀 없음

### 설명 테이블 `radio`/`checkbox`

- 카드 탭은 응답을 변경하지 않고 상세로 이동
- 상세 choice input 탭이 기존 radio/string, checkbox/string[], grouped answer shape를 유지
- 선택 행 표시와 min/max 카운터 유지
- `allowTextInput` 선택 시 상세 입력 노출
- 첫 가시 열 미렌더

### 영속·회귀

- create/update/save/duplicate/publish snapshot에서 새 필드 보존
- 기존 `mobileOriginalTable=true` 질문은 전체 원본 표 유지
- 데스크톱 렌더와 export 결과 불변
- 관련 Vitest, TypeScript, ESLint 실행
