# Task 3 완료 보고서

- 상태: DONE
- 기준 커밋: `a3924d72df54b26ba362f9a24bea96df460978a5`

## 구현

- 데스크톱 표 미리보기, 응답 표, 가상화 그리드, 편집기 셀에 셀별 배경색을 적용했다.
- 명시 배경색은 완료 상태 및 선택/hover 배경보다 우선하며, 선택 ring과 설정 UI는 유지한다.
- 공통 콘텐츠 레이아웃과 텍스트/미리보기 렌더러에서 셀 콘텐츠만 굵게 표시했다. 입력값과 내부 선택지 라벨에는 굵기가 전파되지 않는다.
- 병합 셀은 숨겨진 continuation이 아닌 표시되는 anchor 셀만 배경색을 렌더한다.

## 검증

- `pnpm exec vitest run tests/unit/survey/table-cell-style-rendering.test.tsx`
- `pnpm exec vitest run tests/unit/survey/table-cell-style-rendering.test.tsx tests/unit/survey/preview-cell-choice.test.tsx tests/unit/survey/mobile-original-table.test.tsx`
- `pnpm exec tsc --noEmit`
- 지정 파일 ESLint 검사 (오류 없음, 기존 경고 9개)

모든 테스트와 타입 검사가 통과했다.

## 리뷰 후속 수정

- `TablePreview`에 `applyCellBackground` 경계를 추가하고, 모바일 원본 행 표와 모바일 전체 원본 표는 이를 명시적으로 비활성화했다.
- 실제 응답의 이미지, 비디오, 순위 옵션 셀도 콘텐츠 텍스트에만 굵기를 적용했다.
- 모바일 원본 행 표의 배경색 미적용 및 세 실제 응답 셀의 굵기 렌더링 회귀 테스트를 추가했다.
