/**
 * 모바일 표시 방식 (CONTEXT.md 「모바일 표시 방식」) — 값 목록의 SSOT. 값을 늘리면 스키마의 check() 와
 * 마이그레이션의 CHECK 를 함께 고친다(루트 AGENTS.md 주의사항 1).
 *
 * ── 배선과 규칙 ──
 * - 표시 방식
 *   auto|drilldown-original-row|row-wise-original|row-wise-scale|row-cards|row-group-cards|axis-cards|item-cards|original
 *   (0129 CHECK).
 * - item-cards 「항목 단위 카드」는 테이블 유형 전용 — 한 행에 「라벨 + 입력」 쌍이 여럿 놓인 양식형 표를 글자
 *   셀(라벨)마다 카드 하나로 세운다.
 * - 이어진 라벨은 제목 경로, 세로 병합된 상위 라벨은 아래 행 카드에도 따라가고(그 라벨 하나 아래 같은 보기
 *   그룹의 보기 칸만 이어지면 카드 한 장 — 「2) 지원 부문」 3행, 2026-10-29), 세로 병합된 입력 칸은 시작 행
 *   카드에만 둔다.
 * - 제목이 아닌 글자 셀은 셀의 모바일 표시(숨김 · 바로 표시 · 접기)로 저작자가 지정한다(자동 추정 없음).
 * - 입력 칸 위 라벨은 `mobileLabel` 만 쓰고 엑셀 라벨은 내보내지 않는다(투영
 *   question-renderer/utils/item-cards).
 * - row-wise-scale 「행별 척도」는 행별 원본과 같은 시트에서 각 보기 그룹을 그룹 카드와 같은 보기 모양(세로
 *   타일 기본 · 원본 한 줄 · 척도 막대)으로, 그룹 없는 보기 소스 표는 보기 전체를 막대로, 그 밖의 응답 칸은 열
 *   순서대로 원본 표 조각으로 그린다(행 배치 question-renderer/utils/row-scale-bars).
 * - **척도 슬라이더가 그려지는 표는 이 값보다 슬라이더의 배치가 앞선다**(CONTEXT.md 「척도 슬라이더」) — 슬라이더로
 *   그려지는 행이 있으면 넓은 화면도 표 대신 행 단위 배치이고, 좁은 화면은 row-group-cards 만 그 카드 안에서·그
 *   밖의 값은 무엇이든 row-wise-scale 처럼 그린다(보기 그룹은 제 보기 모양). 그려지는 행이 없으면 이 값
 *   그대로다. 판정은 question-renderer/utils/scale-slider-table-layout 한 곳이고 호스트와 빌더 안내가 같이 쓴다.
 *   보기 그룹의 보기 모양은 넷(세로 타일 · 원본 한 줄 · 척도 막대 · 척도 슬라이더)이고 슬라이더만 웹에도 적용된다.
 * - row-group-cards 는 보기 그룹 표 전용(보기 소스 표·table 유형 둘 다) — 행 카드 안을 보기 그룹(축)별 섹션으로
 *   나누고 구분 셀은 행 카드와 같은 고정 머리(sticky)에 줄바꿈·서식본(contentHtml) 그대로 항상 보임(2026-09-29
 *   — 첫 줄 제목·나머지 회색 설명으로 가르던 것을 걷어냈다. 섹션 제목은
 *   question-renderer/utils/choice-group-section-label. 그룹별 `ChoiceGroup.mobileOriginalLine` 을 켜면 그
 *   그룹만 타일 대신 행별 원본과 같은 원본 표 조각(그룹 열만 잘라 낸 헤더 + 보기 셀,
 *   `MobileOriginalRowTable`)으로 그린다 — 기본 꺼짐, JSONB 라 마이그레이션 없음).
 * - `ChoiceGroup.mobileScaleBar` 를 켜면 그 그룹을 가로 스크롤 없는 척도 막대로 그린다 — `mobileOriginalLine`
 *   과 배타, 읽기·쓰기는 question-renderer/utils/choice-group-mobile-view, 판정은 choice-group-scale-bar(못
 *   그리면 이유 코드와 함께 원본 한 줄 폴백, 빌더 경고는 survey-builder/lib/scale-bar-diagnostics)).
 * - `ChoiceGroup.mobileScaleBarMiddleLabel` 을 켜면 그 그룹의 척도 막대가 한가운데의 여러 칸짜리 구간
 *   이름(10점 척도의 「보통」)도 띠 아래에 둔다 — 기본 꺼짐(CONTEXT.md 「척도 막대」).
 * - axis-cards 는 보기 소스 표에서는 보기 그룹이 축 — 축(그룹)마다 카드 하나, 제목은 열 헤더(sticky), 타일은 행
 *   제목.
 * - 테이블 유형에서는 응답 칸이 놓인 열이 축이라 그룹 없이도 열마다 카드 하나(행 제목 + 그 칸의 입력, 투영
 *   question-renderer/utils/column-axis-cards, 2026-10-02).
 * - 행 제목 앞의 상위 구분 셀(세로 병합으로 내려온 것 포함 — 「내부 R&D」 아래 ①②③)은 카드 안에서 구분이 바뀌는
 *   자리에 소제목으로 선다(`groupCells`, 모바일 표시를 숨기기로 명시한 셀은 제외).
 * - 같은 행의 다른 응답 칸 하나가 여는 상세 입력 칸은 제 열 카드가 아니라 그 칸 바로 아래에 선다(`details`,
 *   2026-10-29).
 * - 테이블 유형에 보기 그룹을 열마다 둔 표(「알고 있음」·「이용한 적 있음」)는 그룹에 속한 보기 칸도 제 열
 *   카드의 항목이 되고 보기 타일(글자 = 행 제목)로 그린다(`includeChoiceOptCells`, 응답 화면 축 카드만 켠다 —
 *   표 아래 상세 기재 투영은 끈 채, 2026-11-09 청암대 재학생 문14 — 전에는 보기 칸을 세지 않아 카드가 0장이라
 *   아무것도 안 보였다)(CONTEXT.md "축 단위 카드")
 * - 행 제목 구역의 글자 셀을 「바로 표시」(`mobileDisplay: 'inline'`)로 두면 행 제목이 아니라 행 제목 아래
 *   설명이 된다(`descriptionCells` — 「적용 산업 | 판단 예시 | 공급 | 활용」의 예시). 같은 행 보기 칸만으로
 *   열리는 입력 칸은 제 열 카드가 아니라 그 보기 타일 아래에, 고른 타일에만 선다(「⑭ 기타」 체크 → 기타 내용,
 *   2026-11-13 피지컬 AI 실태조사 A3).
 */

export const MOBILE_TABLE_DISPLAY_MODES = [
  'auto',
  'drilldown-original-row',
  'row-wise-original',
  'row-wise-scale',
  'row-cards',
  'row-group-cards',
  'axis-cards',
  'item-cards',
  'original',
] as const;

export type MobileTableDisplayMode = (typeof MOBILE_TABLE_DISPLAY_MODES)[number];

export function isMobileTableDisplayMode(value: unknown): value is MobileTableDisplayMode {
  return typeof value === 'string'
    && (MOBILE_TABLE_DISPLAY_MODES as readonly string[]).includes(value);
}

/**
 * 조각 한 화면 칸 수(`Question.mobileDrilldownColumnsPerView`)의 범위 — 값 범위의 SSOT.
 *
 * 좁은 화면의 원본 표 조각에서 자리 폭을 이 수로 나눠 칸 폭을 정한다(끔 = null, 원본 열 폭 그대로).
 * 상한이 6 인 이유: 360px 폰에서 조각이 쓰는 폭이 약 278px 이라 6칸이면 칸이 46px 남짓이고, 보기 라벨의
 * 최소 누름 폭이 44px 이다. 범위를 바꾸면 이 상수와 함께 문항 컬럼의 스키마 check() · 마이그레이션 CHECK 를
 * 고친다(루트 AGENTS.md 주의사항 1) — 셋의 대조는 tests/repo/mobile-piece-columns-per-view-column.test.ts.
 * 이미 적용된 마이그레이션은 고치지 말고 새 마이그레이션에서 제약을 갈아끼운다.
 */
export const MOBILE_PIECE_COLUMNS_PER_VIEW_MIN = 3;
export const MOBILE_PIECE_COLUMNS_PER_VIEW_MAX = 6;

/** 범위 안의 정수만 켜진 값이다 — 그 밖(없음·null·범위 밖·소수)은 꺼진 것으로 읽는다 */
export function resolveMobilePieceColumnsPerView(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MOBILE_PIECE_COLUMNS_PER_VIEW_MIN
    && value <= MOBILE_PIECE_COLUMNS_PER_VIEW_MAX
    ? value
    : null;
}
