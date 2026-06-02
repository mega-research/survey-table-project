# 모바일 테이블 선택형 카드 렌더링 설계

작성일: 2026-06-02

## 1. 문제 정의

라디오/체크박스/순위형이 "설명 테이블"을 동반하는 질문(Case A, `choice_opt`/`ranking_opt`)은
현재 모바일에서도 데스크톱용 `TablePreview`를 그대로 렌더한다. 그 결과:

- 정의/예시 같은 참고 열 때문에 테이블이 화면보다 넓어져 **가로 스크롤**이 발생한다.
- 선택(체크박스/라디오) 열이 화면 밖으로 밀려 **응답자가 선택을 못 찾는다**.

`type='table'`(매트릭스, Case B)은 이미 `MobileTableStepper` + `MobileRowCard`로
세로 카드 전환이 되어 있으나, 이 카드 렌더러는 `text` 셀을 **전부 숨긴다**. 즉 참고 정보를
보여줘야 하는 Case A에는 그대로 쓸 수 없다.

또한 앞으로 "테이블에 뿌리를 둔 선택형" 질문 타입이 더 늘어날 수 있으므로,
타입마다 모바일 UI를 새로 짜는 구조가 아니라 **공유 카드 + 선택 컨트롤 슬롯** 구조가 필요하다.

## 2. 목표 / 비목표

**목표**
- Case A(테이블 내장 radio/checkbox)를 모바일에서 세로 옵션 카드 리스트로 렌더한다.
- 테이블의 `text` 셀을 **셀 단위**로 카드에서 어떻게 보일지 저작자가 지정한다(`숨기기/바로표시/자세히`).
- B(매트릭스)와 Case A, 순위형이 **하나의 공유 카드 컴포넌트**를 재사용하도록 일원화한다.
- 의미(정의/예시 등) 하드코딩 없이 동작한다 — 저작자가 셀별로 결정.

**비목표**
- 데스크톱 렌더링 변경 없음(`TablePreview`/`InteractiveTableResponse` 그대로).
- 순위형의 모바일 선택 UX 전면 재설계 없음(아래 6.3 참조 — 드롭다운 스택 유지).
- 열 단위 설정/대량 적용 편의기능(YAGNI — 추후 필요 시).
- 데이터 모델/응답 shape 변경 없음. 분석/SPSS export 영향 없음.

## 3. 핵심 결정 (확정됨)

| 항목 | 결정 |
|------|------|
| 설정 단위 | **셀 단위** (`TableCell.mobileDisplay`) |
| 상태 | `hidden`(기본) / `inline`(바로표시) / `collapsed`(자세히) |
| 기본값 | text 셀 미설정 = `hidden` → 기존 설문 영향 0 |
| 접기 라벨 | **"자세히"** (의미 추측 안 함, 고정 문구) |
| 아키텍처 | 접근 2 — 공유 카드 컴포넌트 추출 + 선택 컨트롤 슬롯 |
| 순위형 | B안 — 드롭다운 스택 상단 유지 + 카드는 참고 표시 전용 |
| 카드 헤더 라벨 | choice_opt 옵션 라벨(`resolveChoiceOptions`) |
| 선택 토글 | 체크박스 + 카드 헤더 줄 전체 탭 / "자세히"는 별도 탭 |

## 4. 데이터 모델

`src/types/survey.ts`의 `TableCell`에 필드 1개 추가:

```ts
// 모바일 카드에서 이 셀(주로 text/image/video 표시 셀)을 어떻게 노출할지.
// 미지정 = 'hidden' (기존 동작: 카드에 미노출). 입력 셀(input/radio/checkbox/select/
// choice_opt/ranking_opt)은 이 값을 무시하고 항상 선택 컨트롤로 렌더된다.
mobileDisplay?: 'hidden' | 'inline' | 'collapsed';
```

- 마이그레이션 불필요(옵셔널 JSONB 필드, 기본 `hidden`).
- `tableRowsData`(JSONB)에 함께 직렬화되므로 스키마 변경 없음.

## 5. 빌더 변경 — 셀 토글

`src/components/survey-builder/cell-content-modal.tsx`

- `text`/`image`/`video` 셀 편집 시 3-state 세그먼트 컨트롤 노출:
  `숨기기 | 바로표시 | 자세히`. 값 = `mobileDisplay`.
- 입력 셀 타입에는 미노출(항상 컨트롤로 렌더되므로 의미 없음).
- 라벨/도움말: "모바일 카드에서 표시 — 숨기기(기본)/바로표시/자세히(접기)".
- 저장은 기존 explicit field set 패턴 점검 필요(스토어/액션). `mobileDisplay`가
  cell 객체에 보존되는지 확인.

## 6. 응답 렌더링 변경

### 6.1 공유 컴포넌트 추출 — `MobileOptionCard`

`src/components/survey-response/mobile-option-card.tsx` (신규)

기존 `MobileRowCard`의 카드 스타일/레이아웃을 추출·일반화. 책임:

- **헤더**: 라벨(필수) + 선택 시 완료/체크 표식(옵션).
- **inline 표시 셀**: `mobileDisplay==='inline'`인 셀 content를 라벨 아래 인라인 렌더.
- **자세히 expander**: `mobileDisplay==='collapsed'`인 셀이 1개 이상이면
  "자세히 ▾" 토글 + 펼침 영역에 해당 셀들 렌더(`useState` 로컬 열림 상태).
- **control 슬롯**: `control?: React.ReactNode` — 선택 UI를 주입받음(체크박스/라디오/입력 셀들).
- 토큰 치환(`substituteTokens` + `useContactAttrs`)은 기존대로 유지.

인터페이스(개략):

```ts
interface MobileOptionCardProps {
  label: React.ReactNode;          // 헤더 라벨
  inlineCells: TableCell[];        // mobileDisplay==='inline'
  collapsedCells: TableCell[];     // mobileDisplay==='collapsed'
  control?: React.ReactNode;       // 선택/입력 컨트롤 슬롯
  selected?: boolean;              // 선택 시 강조 스타일
  onToggle?: () => void;           // 헤더 줄 탭 → 선택 토글(Case A)
}
```

표시 셀 렌더는 `content`(text) / `imageUrl`(image) / `videoUrl`(video)를
읽어 읽기 전용으로 그린다.

### 6.2 Case A — `ChoiceTableResponse` 모바일 분기

`src/components/survey-response/choice-table-response.tsx`

- `useMobileView()` 분기 추가. 데스크톱은 기존 `TablePreview` 경로 유지.
- 모바일: `tableRowsData`의 행을 순회하며 행마다 `MobileOptionCard` 렌더.
  - 라벨 = 행의 choice_opt 옵션 라벨(`resolveChoiceOptions`로 매핑, cell.id = option.value).
  - control = 체크박스(checkbox)/라디오(radio). 기존 `toggle()` 로직 재사용.
  - `onToggle` = 헤더 줄 탭 → 동일 토글.
  - inline/collapsed 셀 = 그 행의 text 셀들을 `mobileDisplay`로 분류.
  - 선택 옵션의 `allowTextInput`이면 카드 안에 `OptionTextInput` 렌더(기존 유지).
- min/max 카운터 기존대로 하단 노출. `maxSel` 도달 시 미선택 카드 비활성.
- 응답 shape 불변(radio=cell.id|null, checkbox=cell.id[]).

### 6.3 순위형 — `RankingQuestion` 모바일 분기

`src/components/survey-response/ranking-question.tsx`

- 상단 `RankingDropdownStack`은 모바일에서도 유지(선택=순위 배정 그대로).
- 하단 내장 테이블(`hasEmbeddedTable`)만 모바일에서 `TablePreview` 대신
  `MobileOptionCard` 리스트(control 없음, 참고 표시 전용)로 렌더.
  - 라벨 = ranking_opt 옵션 라벨. inline/collapsed = text 셀의 `mobileDisplay`.
- 데스크톱은 기존 유지.

### 6.4 B(매트릭스) — `MobileRowCard` 정렬

`src/components/survey-builder/mobile-row-card.tsx`

- 카드 외형/레이아웃을 `MobileOptionCard` 기반으로 재구성(중복 제거).
- 기존: text 셀 전부 숨김 → 변경: `mobileDisplay==='inline'|'collapsed'`인 text 셀은
  노출(기본 `hidden`이라 **미설정 기존 설문은 동작 동일**).
- 입력 셀들은 control 슬롯(또는 본문)에 기존대로 렌더(단위쌍/섹션 헤더 로직 유지).
- 회귀 주의: 단위 페어(`detectUnitPair`), 섹션 헤더, 정렬 클래스는 보존.

## 7. 영향 범위 / 비영향

- **비영향**: 응답 저장 shape, 분석(analyzer/cross-tab/filter), SPSS export,
  분기 로직, 데스크톱 렌더, DB 스키마.
- **영향**: `TableCell` 타입, cell-content-modal, choice-table-response,
  ranking-question, mobile-row-card, 신규 mobile-option-card.

## 8. 엣지 케이스

1. **모든 text 셀이 hidden(기본)** — Case A 카드는 라벨+체크박스만. "자세히" 미표시. 정상.
2. **inline + collapsed 혼재** — 한 카드에 인라인 영역 + "자세히 ▾" 둘 다 표시.
3. **이미지/비디오 표시 셀** — `mobileDisplay`로 동일 제어(inline/collapsed에서 렌더).
4. **rowspan/colspan continuation 셀**(`_isContinuation`, `isHidden`) — 카드 렌더에서 제외.
5. **긴 라벨** — 헤더 줄바꿈 허용(현재 카드 스타일 유지).
6. **다단 헤더 섹션(B)** — 기존 섹션 헤더 표시 로직 유지(MobileRowCard 경로).
7. **displayCondition 행/열** — Case A 카드는 행 필터를 평가하지 않는 기존 한계 동일
   (순위형 Case 2와 같은 구조적 한계). 본 작업 범위 밖, 회귀 아님.
8. **테스트 모드(빌더 미리보기)** — 응답 컴포넌트가 아닌 빌더 프리뷰 경로는
   기존 그대로(이번 변경은 응답/모바일 한정). 필요 시 후속.

## 9. 검증

- ESLint 인프라가 깨져 있으므로(`pnpm lint` 불가) `tsc` + `vitest` + `build`로 검증.
- 실제 DB의 Case A 질문(스크린샷 Q2)으로 모바일 뷰 수동 확인.
- 기존 매트릭스(B) 질문이 모바일에서 동일하게 보이는지 회귀 확인(text 셀 기본 hidden).
