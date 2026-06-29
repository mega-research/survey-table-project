# 응답 헤더 정렬 옵션 Design

> 작성일: 2026-06-29
> 선행: [응답 페이지 헤더 설계](2026-06-29-survey-response-header-design.md), [빌더 진입점 모달](2026-06-29-survey-header-builder-entry-design.md)

## 배경 / 목표

응답 헤더에 두 가지 정렬 옵션을 추가한다.

1. **제목 정렬** — 왼쪽 / 중앙 / 오른쪽. 모든 스타일(기본형·제목 옆 로고형·양끝 정보형) 공통.
2. **로고 세로 정렬** — 위 / 중앙 / 아래. 양끝 정보형 전용 (통계법 박스 기준 로고의 세로 위치).

## 비목표 (YAGNI)

- 로고 가로 정렬, 설명문 독립 정렬, 모바일 전용 정렬.
- 제목 옆 로고형의 로고 세로 정렬(이미 제목 옆 세로 중앙이라 불필요).

## 데이터 모델

`src/db/schema/schema-types.ts`:

```ts
export type ResponseHeaderTitleAlign = 'left' | 'center' | 'right';
export type ResponseHeaderLogoAlign = 'top' | 'center' | 'bottom';
```

- `titleAlign?: ResponseHeaderTitleAlign` 를 `SurveyResponseHeaderConfig` 의 세 변형 모두에 추가(전역, optional).
- `logoAlign?: ResponseHeaderLogoAlign` 를 `official-band` 변형의 `officialBand` 객체에만 추가(optional).

JSONB 컬럼 `surveys.response_header` 는 이미 존재 → **마이그레이션 불필요**. 신규 키는 optional 이라 레거시 row 와 호환.

## 정규화 / 헬퍼 (`src/lib/survey/response-header-config.ts`)

`normalizeResponseHeaderConfig` 가 누락 값을 스타일별 기본으로 채운다:

- `titleAlign` 기본: `plain` → `left`; `logo-title`·`official-band` → `center` (현재 동작 보존).
- `logoAlign` 기본(official-band): `top` (현재 `md:items-start` 와 동일 → 기존 배포 스냅샷 픽셀 보존).

헬퍼 추가:

```ts
export function getTitleAlignClass(align: ResponseHeaderTitleAlign): string {
  // 'left' -> 'text-left', 'center' -> 'text-center', 'right' -> 'text-right'
}
export function getLogoAlignClass(align: ResponseHeaderLogoAlign): string {
  // 'top' -> 'md:items-start', 'center' -> 'md:items-center', 'bottom' -> 'md:items-end'
}
```

## 렌더링 (`src/components/survey-response/survey-response-header.tsx`)

- `TitleBlock` 의 `centered: boolean` prop 을 `align: ResponseHeaderTitleAlign` 으로 교체.
  - 제목/설명 컨테이너에 `getTitleAlignClass(align)` 적용. 래퍼에 `data-title-align={align}` 부여(테스트용).
  - 설명문은 `align === 'center'` 일 때만 `mx-auto max-w-3xl`, 그 외에는 가로 중앙 정렬 제거.
- 세 스타일 모두 `align={config.titleAlign}` 전달.
- `official-band` 의 로고+통계법 flex row: 하드코딩 `md:items-start` 를 `getLogoAlignClass(config.officialBand.logoAlign)` 로 교체. 같은 row 요소(또는 layout 래퍼)에 `data-logo-align` 부여.

기존 `data-testid`(`logo-title-layout`, `official-band-layout`)와 `data-arrangement`/`data-logo-position` 은 유지.

## 빌더 UI (`src/components/survey-builder/response-header-settings.tsx`)

- **제목 정렬**: 메인 영역(스타일 선택/로고 블록 아래)에 항상 표시. `PresetButtonGroup` 재사용, 옵션 `[['left','왼쪽'],['center','중앙'],['right','오른쪽']]`.
- **로고 세로 정렬**: `official-band` 조건 블록의 "양끝 배치" 근처에 표시. `PresetButtonGroup`, 옵션 `[['top','위'],['center','중앙'],['bottom','아래']]`.
- 핸들러 `updateTitleAlign(align)`(전 스타일에서 config 머지 후 onChange), `updateLogoAlign(align)`(official-band 가드 후 머지).

## 테스트

`tests/unit/survey/response-header-config.test.ts` (확장):
- `getTitleAlignClass` / `getLogoAlignClass` 매핑 단언.
- `normalizeResponseHeaderConfig` 가 titleAlign(plain=left, logo-title/official-band=center)·logoAlign(official-band=top) 기본값을 채움.

`tests/unit/survey/survey-response-header.test.tsx` (확장):
- 제목 정렬이 `data-title-align` 으로 반영.
- official-band 로고 세로 정렬이 `data-logo-align` 으로 반영.

`tests/unit/survey/response-header-settings.test.tsx` (확장):
- 제목 정렬 버튼이 모든 스타일에서 표시되고 클릭 시 onChange 가 `titleAlign` 갱신.
- 로고 세로 정렬 버튼은 official-band 에서만 표시되고 클릭 시 `logoAlign` 갱신.

## 호환성 / 영향

- 저장/조회/스냅샷 경로는 settings.responseHeader 를 통째로 운반하므로 추가 변경 없음(읽기 경로의 normalize 가 기본값 보강).
- 모달 미리보기는 `SurveyResponseHeader` 재사용이라 자동 반영.
- 기존 테스트의 `centered` 의존 제거(있다면 `align` 으로 갱신).
