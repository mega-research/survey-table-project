# 모바일 드릴다운 + 선택 행 원본 렌더링 — 설계

> 작성일: 2026-07-21
> 상태: 구현 완료, 회귀 검증 완료
> 구현 계획: [2026-07-21-mobile-drilldown-original-row.md](../plans/2026-07-21-mobile-drilldown-original-row.md)

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
- 상세 표: 작성자가 지정한 개수만큼 원본 테이블의 왼쪽 선행 열을 제외한다. 이 열들의 항목명은
  이미 드릴다운 카드와 상세 제목에서 표시되므로 반복하지 않는다.
- 척도 헤더와 라디오·체크박스·기타 입력 셀은 한 줄을 유지하고 기존 가로 스크롤 수단으로 이동한다.

적용 대상은 다음 두 경우다.

- `type='table'` 질문
- `radio`/`checkbox` 질문의 “설명 테이블로 보기” 구성

## 목표

1. 질문별 새 모바일 표시 옵션으로 “드릴다운 + 선택 행 원본” 모드를 제공한다.
2. 기존 드릴다운 목차, 뒤로/다음 이동 및 응답 저장 로직을 최대한 재사용하고, 진행 상태는 기존
   `행 완료 판정`을 재사용해 항목 단위로 표시한다.
3. 상세 원본 행에서 설정된 **원본 선행 열**을 제외하고 나머지 헤더·셀의 정렬을 보존한다.
4. 다단 헤더, colspan/rowspan, 조건부 가시 열, 동일 행 라디오 그룹을 깨뜨리지 않는다.
5. 데스크톱 렌더, 응답 저장 shape, 분석/SPSS/엑셀 export를 변경하지 않는다.

## 비목표

- “10점 척도”를 셀 개수나 라벨로 자동 판별하지 않는다.
- 점수 버튼·슬라이더 같은 척도 전용 응답 컴포넌트를 새로 만들지 않는다.
- `ranking` 내장 설명 테이블에는 이번 모드를 적용하지 않는다.
- 중간 열을 개별 선택해 숨기는 열 매핑 UI는 만들지 않는다. 왼쪽부터 연속된 선행 열 개수만 설정한다.
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

모바일 표시 방식의 정본은 상호 배타적인 단일 enum으로 둔다.

```ts
type MobileTableDisplayMode = 'auto' | 'drilldown-original-row' | 'original';

mobileTableDisplayMode?: MobileTableDisplayMode;
mobileDrilldownOmitLeadingColumns?: number;
```

- 표시 모드의 기본값은 `auto`, 상세 제외 선행 열 수의 기본값은 `1`이다.
- `questions.mobile_table_display_mode text default 'auto'`와
  `questions.mobile_drilldown_omit_leading_columns integer default 1` 컬럼을 추가한다.
- 표시 모드 DB 값은 `auto | drilldown-original-row | original` check constraint로 제한한다.
- `Question`, DB schema type, survey-builder zod 입력, `PERSISTED_QUESTION_FIELDS`, 생성·저장·복제
  채널에 포함한다.
- 배포 스냅샷에는 기존 질문 직렬화 경로를 통해 포함된다.

기존 `mobileOriginalTable`은 과거 DB 데이터와 불변 배포 스냅샷을 읽기 위한 **레거시 호환 필드**로
유지한다. 새 빌더 쓰기의 정본으로 사용하지 않는다.

- DB 마이그레이션에서 `mobile_original_table=true`인 기존 질문을 `mobile_table_display_mode='original'`로
  백필한 뒤 나머지는 `auto`로 둔다.
- 새 질문 저장과 편집은 `mobileTableDisplayMode`만 쓴다.
- 새 필드가 없는 과거 배포 스냅샷은 `mobileOriginalTable=true`면 `original`, 아니면 `auto`로 읽는다.
- 새 필드가 있으면 enum을 정본으로 사용하고 레거시 boolean은 무시한다.
- 신뢰 불가 snapshot의 enum 값이 유효하지 않으면 레거시 boolean 폴백을 적용한다.
- 스냅샷 read 경계에서는 enum의 **키 부재를 유지한 채** 위 우선순위로 모드를 해석한다. zod default나
  사전 정규화로 `auto`를 먼저 주입하면 과거 스냅샷의 `mobileOriginalTable=true`를 가리므로, 모드
  resolver가 레거시 폴백을 끝낸 뒤에만 최종 `auto` 기본값으로 수렴한다.

따라서 런타임은 항상 하나의 `MobileTableDisplayMode`만 소비하며 모순 조합이 존재하지 않는다.

### 1.2 편집 UI

`DynamicTableEditor`의 현재 “모바일에서 원본 표로 보기” 단일 토글을 **모바일 표시 방식** 선택으로
교체한다.

- 자동 카드: `auto`
- 드릴다운 + 선택 행 원본: `drilldown-original-row`
- 원본 표: `original`

세 선택은 UI에서 상호 배타적이다. 새 모드는 현재 편집 중인 질문이 다음 중 하나일 때만 노출한다.

- `type='table'`
- `type='radio' | 'checkbox'`이고 설명 테이블 모드(`tableColumns`/`tableRowsData`)가 활성화됨

`ranking`에서는 노출하지 않는다. 저장 직전 store 최신값을 form data에 합치는 기존
`mobileOriginalTable` 경로를 enum 정본 필드와 상세 제외 선행 열 수에 맞게 교체한다.

“드릴다운 + 선택 행 원본”을 선택하면 숫자 입력 **상세에서 제외할 앞쪽 열 수**를 추가로 노출한다.

- 기본값 `1`
- 허용값 `0..전체 원본 열 수 - 1`
- `2`이면 작성된 원본 테이블의 첫 번째·두 번째 열을 상세에서 제외
- 열 삭제로 저장값이 범위를 벗어나면 렌더 시 안전 범위로 clamp
- `0`이면 항목 열을 포함한 선택 행 전체를 상세에 표시
- 응답 셀이 남는지 행별 분석하거나 별도 경고·저장 차단을 추가하지 않음. 작성자가 테스트 모드에서 확인

## 2. 공통 선택 행 투영

새 순수 유틸은 작성된 원본 열 목록과, 런타임 조건 필터가 끝난 `visibleColumns`,
`visibleHeaderGrid`, 전체 `displayRows`, 선택 행 ID를 받아 상세 표 조각을 만든다.

```ts
projectMobileOriginalRow({
  authoredColumns,
  visibleColumns,
  visibleHeaderGrid,
  displayRows,
  selectedRowId,
  omitLeadingAuthoredColumns,
})
```

규칙:

1. 설정값을 `0..authoredColumns.length - 1`로 clamp한다.
2. 원본 열 목록의 왼쪽부터 설정 개수만큼 column ID를 제외 대상으로 정한다. 제외 대상 열이
   표시조건으로 이미 숨었더라도 다음 가시 열을 대신 제외하지 않는다.
3. 제외 대상에 속하지 않는 가시 열 ID 집합과 **전체 displayRows**를
   `recalculateColspansForVisibleColumns`에 전달하여 행 셀,
   colspan 및 다단 헤더 colspan을 함께 재계산한다. 전체 행을 먼저 투영해야 앞 행의 병합 시작 셀과
   continuation 관계를 잃지 않는다.
4. 재계산 결과에서 선택 행 하나를 꺼낸다. 항목명은 투영 전에 드릴다운 라벨로 확보한다.
5. 한 행만 렌더하므로 본문 셀의 `rowspan`은 1로 정규화한다. 다단 헤더 자체의 rowspan은 유지한다.
6. 제외 후 표시 가능한 인터랙티브 셀이 없으면 원본 행 렌더 대신 기존 카드 상세로 폴백한다. 이는
   과거·오염 데이터에 대한 런타임 안전장치일 뿐, 빌더에서 별도 사전 분석하지 않는다.

단순 `columns.slice(n)`/`row.cells.slice(n)`만 사용하지 않는다. 병합 시작 셀이 제거되거나 다단
헤더가 제외 선행 범위를 가로지를 때 continuation/colspan 정합성이 깨질 수 있기 때문이다.

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
- 같은 질문의 상세 항목 사이에서 공유되는 가로 `scrollLeft` 적용
- 한 개 행의 원본 셀 경계·정렬·colspan 렌더
- `isHidden`/`_isContinuation`, rowspan/colspan, `isHeaderHidden`, `hideColumnLabels` 보존
- 셀 타입에 따른 `mobileDisplay='hidden'` 의미 적용
- 오류 셀 ring 및 `data-cell-id` 유지

비책임:

- 드릴다운 상태와 목차
- 응답 shape 해석
- 어떤 열을 제외할지 결정

이를 통해 `table`과 설명 테이블 선택형이 동일한 헤더/행 레이아웃을 사용하면서, 실제 입력 렌더러만
각 도메인의 기존 로직을 주입한다.

### 3.1 공통 드릴다운 탐색 껍데기

`radio`/`checkbox` 설명 테이블용으로 별도 탐색 UX를 만들지 않는다. 기존 복잡한 매트릭스의
`MobileTableDrilldown`에서 다음 책임을 공통 탐색 껍데기로 추출한다.

- 목차 → 하위 항목 → 상세의 nav 상태
- breadcrumb와 `뒤로`
- `이전 항목 / 다음 항목 / 다음 섹션 / 목차로`
- nav 변경 시 드릴다운 root 상단 스크롤
- 완료 상태와 진행률 표시 슬롯

공통 껍데기는 실제 셀 렌더와 응답 shape를 소유하지 않는다. 두 adapter가 데이터를 주입한다.

- `table` adapter: 기존 `classifyTable()`의 section/leaf와 `isTableRowCompleted()` 결과
- 설명 테이블 adapter: 기존 `classifyTable()`의 section/leaf 계층, 원본 행별 label/선택 상태와 기존
  min/max 선택 카운터

설명 테이블도 현재 복잡한 매트릭스 규칙을 그대로 거치게 한다. 이를 위해 `classifyTable()`에 선택적
`isInputCell` 또는 동등한 answerable 타입 집합을 주입할 수 있게 하고, 기본값은 현재 table 셀 타입
규칙을 유지한다. 설명 테이블 adapter만 `choice_opt`를 answerable 셀로 추가한다. 이렇게 하면
rowspan 기반 section/leaf 분류와 breadcrumb는 재사용하면서 `choice_opt`를 모르던 기존 table 분류의
동작은 바뀌지 않는다.

따라서 기존 복잡한 매트릭스의 이동 감각과 버튼 위치를 그대로 유지하면서 상세 body만
`OriginalRowTable`로 교체한다.

## 4. `type='table'` 응답 흐름

`InteractiveTableResponse`는 정규화한 모바일 표시 모드를 `MobileTableDrilldown`에 전달한다.

- `auto`: 현재 카드/드릴다운 동작 유지
- `original`: 현재 전체 원본 표 동작 유지
- `drilldown-original-row`: 첫 화면과 중간 리프 목록은 현재 `MobileTableDrilldown` 그대로 유지하고,
  `nav.leaf !== null` 상세에서 `OriginalRowTable`을 렌더

`drilldown-original-row`는 작성자의 명시적 선택이므로 기존 `decideDrilldown()`의 입력 수 임계값을
우회해 항상 드릴다운 경로를 사용한다. 행이 하나뿐이어도 자동으로 상세를 열지 않고
`항목 카드 1개 → 카드 탭 → 원본 행 상세`의 동일한 흐름을 유지한다. 단일 행 특례는 만들지 않는다.

상세의 가로 스크롤 위치는 같은 질문 안의 `이전 항목 / 다음 항목 / 다음 섹션` 이동에서 유지한다.
응답자가 0~10 척도의 오른쪽 구간을 보고 있다면 다음 행도 같은 `scrollLeft`에서 시작한다. 행별 폭이
더 짧으면 브라우저의 유효 최대값으로 clamp한다. `목차로` 돌아가거나 질문 컴포넌트가 unmount되면
왼쪽 `0`으로 초기화한다.

상세 입력은 기존 `InteractiveCell`을 그대로 사용한다. 동일 행·동일 `radioGroupName` 셀은 기존
`resolveRadioGroupProps` 로직을 공용 유틸로 이동하여 공통 HTML `name`과 sibling clear를 보존한다.

항목 라벨은 `ClassifiedLeaf.label`을 breadcrumb와 상세 제목에 사용한다. 해당 라벨이 들어 있던 첫
가시 열은 상세 원본 표에서 제외한다.

### 진행 상태

새 모드의 진행률은 입력 셀 수가 아니라 **완료 행 수 / 전체 행 수**다. 예를 들어 0~10 척도 5행은
`0 / 55칸`이 아니라 `0 / 5개 항목`으로 시작하고, 첫 행에서 점수 하나를 선택하면
`1 / 5개 항목`이 된다.

완료 여부는 새 계산을 만들지 않고 기존 `isTableRowCompleted()`를 사용한다.

- 동일 행·동일 `radioGroupName`의 radio 셀들은 하나의 single-select 그룹이다. 하나를 선택하면
  그 그룹은 응답됨이다.
- 한 행에 독립된 input/select/checkbox/라디오 그룹이 여러 개면 모든 answerable 단위가 응답되어야
  그 행이 완료된다.
- 단순 방문이나 다음 항목 이동은 응답값을 만들지 않으므로 완료 행 수를 올리지 않는다.

기존 `MobileTableDrilldown`의 cell-count/`acknowledged` 기반 진행률은 새 모드에서 사용하지 않는다.
`auto` 모드의 기존 진행 동작은 이번 작업에서 바꾸지 않는다. 저장 데이터도 변경하지 않는다.

## 5. `radio`/`checkbox` 설명 테이블 흐름

`ChoiceTableResponse`의 새 모바일 분기는 기존 카드 탭의 의미를 다음처럼 바꾼다.

1. 첫 화면: 행별 드릴다운 카드 목록
2. 카드 탭: 선택하지 않고 해당 행 상세로 이동
3. 상세 원본 행의 `choice_opt` 라디오/체크박스 탭: 실제 응답 선택
4. 뒤로/다음 항목: 기존 드릴다운과 같은 탐색
5. 입력 직후 자동 이동하지 않고 현재 상세 화면에 머무름

새 모드의 목차 단위는 `choice_opt` 셀이 아니라 **원본 행**이다. 한 행에 `choice_opt`가 여러 개여도
카드는 하나만 만들고, 상세 원본 행 안에 그 선택 컨트롤들을 모두 표시한다. 현재 자동 카드 모드의
셀별 카드 생성은 변경하지 않는다.

실제 선택·해제는 현재 `ChoiceTableResponse`의 다음 로직을 그대로 주입한다.

- `getChoiceCellState`
- `toggle`
- grouped choice의 `getGroupKeyOfCell` / `getGroupTypeOfCell`
- `OptionTextInput`
- min/max 선택 카운터

첫 화면 카드는 선택 여부를 표시하지만 카드 전체 탭으로 값을 변경하지 않는다. radio 질문은 선택된 행
1개, checkbox 질문은 선택된 여러 행을 표시한다. 진행률 대신 선택형 질문의 기존 선택 카운터와
min/max 안내를 유지한다.

선택 후 이동 동작도 기존 복잡한 매트릭스와 같다. 값은 즉시 저장하되 화면은 이동하지 않으며,
사용자가 `이전 항목 / 다음 항목 / 다음 섹션 / 목차로`를 눌러 탐색한다. 이 규칙은 checkbox 다중 선택,
radio 재선택 및 `allowTextInput` 후속 입력을 모두 안전하게 보존한다.

행 제목 우선순위는 행 단위 의미에 맞춰 다음처럼 정한다.

1. 상세 제외 대상으로 지정된 선행 열 중 오른쪽부터 찾은 첫 번째 비어 있지 않은 text/header 셀 내용
2. `row.label`
3. 행의 첫 번째 `choice_opt` resolved option label
4. `(라벨 없음)` 폴백

오른쪽 선행 열을 우선하는 이유는 `대분류 | 항목 | 선택…` 구조에서 가장 구체적인 `항목`을 카드
제목으로 쓰고, 상위 `대분류`는 기존 드릴다운 section/breadcrumb가 표현하기 때문이다.

## 6. 데이터 흐름

```text
빌더 모바일 표시 선택
  → question.mobileTableDisplayMode / mobileDrilldownOmitLeadingColumns
  → 저장·publish snapshot
  → 응답 페이지에서 mode 정규화
     ├─ auto: 기존 모바일 카드/드릴다운
     ├─ original: 기존 전체 원본 표
     └─ drilldown-original-row
          → 기존 행/섹션 목차
          → 선택 row + 설정된 원본 선행 열 제외 투영
          → 공통 OriginalRowTable
             ├─ table: InteractiveCell
             └─ 설명 테이블: ChoiceTableResponse renderCell
```

응답 키는 기존 `cell.id`를 그대로 사용한다. 분석, 분기 로직, 정규화, export에는 변경이 없다.

## 7. 오류·엣지 케이스

1. **열이 1개뿐임**: 설정값을 0으로 clamp하여 최소 한 개 원본 열을 남긴다.
2. **제외 대상 열이 조건으로 숨겨짐**: 다음 가시 열을 대신 제외하지 않는다.
3. **제외 대상 열이 colspan 시작 셀**: 공용 재계산 유틸로 남은 colspan과 continuation을 복구한다.
4. **다단 헤더**: 제외된 열 수만큼 각 헤더 셀 colspan을 재계산하고 빈 헤더 행을 제거한다.
5. **행 displayCondition/동적 행**: 기존 `displayRows`를 입력으로 쓰므로 숨은 행은 목차·상세·진행률 분모에서 모두 제외한다.
6. **동일 행 radio 그룹**: 공통 name + sibling clear로 단일 선택을 유지한다.
7. **구조적 숨김·병합**: `isHidden`/`_isContinuation`은 렌더하지 않고, 투영 후 재계산된 rowspan/colspan과 `isHeaderHidden`을 유지한다.
8. **헤더 숨김**: 질문의 `hideColumnLabels=true`면 상세 원본 행에서도 열 헤더 전체를 숨긴다.
9. **정적 셀 mobile hidden**: text/image/video의 `mobileDisplay='hidden'`은 콘텐츠를 숨기며 카드·breadcrumb 제목 후보에서도 제외한다. 숨긴 text와 같은 값인 `row.label` 폴백으로 다시 노출하지 않는다.
10. **입력 셀 mobile hidden**: radio/checkbox/input/select/ranking/`choice_opt`의 `mobileDisplay='hidden'`은 라벨만 숨기고 응답 컨트롤은 유지한다.
11. **Case A 카드 탭**: 탐색 전용이다. 실제 선택은 상세 행의 입력에서만 발생한다.
12. **Case A 한 행에 여러 선택 셀**: 목차 카드는 한 개이며 상세 원본 행 안에 모두 표시한다.
13. **상세 입력 후 이동**: 값을 저장하고 현재 상세에 머문다. 자동으로 다음 항목이나 목차로 이동하지 않는다.
14. **과거 snapshot**: enum 부재 시 레거시 `mobileOriginalTable`로 모드를 복원한다.
15. **유효하지 않은 enum**: 레거시 boolean 폴백 후 `auto`로 안전하게 수렴한다.
16. **응답 페이지 snapshot**: publish 전 빌더 변경은 공개 응답에 반영되지 않는 기존 규칙을 유지한다.
17. **단일 행 표**: 드릴다운 카드 한 개를 먼저 표시하며 자동 상세 진입하지 않는다.
18. **항목 간 가로 위치**: 같은 질문의 상세 이동에서는 유지하고 목차 복귀·질문 이탈 시 초기화한다.

## 8. 변경 범위

예상 주요 변경:

| 영역 | 변경 |
|---|---|
| DB·타입 | 모바일 테이블 표시 enum + 상세 제외 선행 열 수 컬럼·타입·zod·SSOT·마이그레이션·레거시 백필 |
| 빌더 | 모바일 표시 방식 3개 선택, 저장 직전 store 병합 |
| 공통 유틸 | 모바일 모드 정규화, 원본 선행 열 제외 행 투영, radio 그룹 props |
| 공통 UI | 기존 복잡한 매트릭스 드릴다운 탐색 껍데기, 원본 한 행 헤더/바디/스크롤 렌더러 |
| table 응답 | 기존 드릴다운 상세에서 새 원본 행 렌더 분기 |
| Case A 응답 | 행 목차 → 상세 원본 행 탐색 분기, 기존 toggle 주입 |

## 9. 테스트 전략

### 순수 유틸

- 모드 정규화 3종, 과거 snapshot boolean 폴백, 유효하지 않은 enum 폴백
- 과거 snapshot에 enum 키가 없을 때 기본 `auto`를 먼저 주입하지 않고 레거시 true를 `original`로 복원
- 상세 제외 선행 열 수 0/1/N과 범위 clamp
- 제외 대상 열 조건 숨김 시 다음 가시 열 보존
- colspan/rowspan 및 다단 헤더 재계산
- 구조적 hidden/continuation, `hideColumnLabels`, `isHeaderHidden` 보존
- 정적 셀과 입력 셀의 `mobileDisplay='hidden'` 차등 적용
- 제외 후 인터랙티브 셀 없음 폴백
- 기존 `isTableRowCompleted()`를 이용한 행 단위 진행률과 radio 그룹 완료 판정

### `type='table'`

- 새 모드 첫 진입 시 기존 드릴다운 목차 표시
- 입력 수 임계값 이하와 단일 행에서도 드릴다운 카드 먼저 표시
- 행 카드 탭 후 설정된 선행 열 항목명이 상세 제목에는 있고 원본 grid에는 없음
- 헤더와 0~10 입력 셀이 한 줄·동일 scrollLeft로 이동
- 다음 항목 이동 시 가로 위치 유지, 목차 복귀 시 왼쪽 초기화
- radio 한 개 선택 시 sibling 응답 clear 및 해당 행 완료 처리
- 미응답 행 방문은 완료로 세지 않음
- 뒤로/다음 항목 이동과 완료 행 수 기반 전체 진행 상태 유지
- auto/original 기존 분기 회귀 없음

### 설명 테이블 `radio`/`checkbox`

- 카드 탭은 응답을 변경하지 않고 상세로 이동
- 한 행에 choice 셀이 여러 개여도 목차 카드 하나만 생성
- rowspan/병합 기반 설명 테이블이 기존 `classifyTable()`과 같은 section/leaf 계층과 breadcrumb를 생성
- 상세 choice input 탭이 기존 radio/string, checkbox/string[], grouped answer shape를 유지
- 선택 행 표시와 min/max 카운터 유지
- `allowTextInput` 선택 시 상세 입력 노출
- 선택 직후 자동 이동 없이 기존 드릴다운 이동 버튼 유지
- 설정된 원본 선행 열 미렌더
- 구조적 병합·헤더 숨김·모바일 셀 표시 설정 유지

### 영속·회귀

- create/update/save/duplicate/publish snapshot에서 새 필드 보존
- 기존 DB와 snapshot의 `mobileOriginalTable=true` 질문은 전체 원본 표 유지
- 데스크톱 렌더와 export 결과 불변
- 관련 Vitest, TypeScript, ESLint 실행
