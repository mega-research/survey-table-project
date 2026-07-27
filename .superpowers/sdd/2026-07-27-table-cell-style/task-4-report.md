# Task 4 Report: 모바일 예외, 옵션 스타일 전파, 복사 보존

## Status: DONE

## 변경 사항

- `choice_opt`와 `ranking_opt`의 `textBold`·`backgroundColor`를 파생 `QuestionOption`에 보존했다.
- 기타 순위 옵션(`isOtherRankingCell`) 분기에도 동일한 스타일 전파를 적용했다.
- 모바일 표시 셀, 선택지 카드 라벨, 순위 참조 카드 라벨에만 Bold를 적용했다.
- 모바일 카드 컨테이너 배경은 기존 `bg-white`를 유지하며 인라인 배경색을 전달하지 않는다.
- 데스크톱 choice 옵션의 셀 라벨에도 Bold를 적용했다.
- 영역 복사 스냅샷이 셀 스타일을 그대로 보존하는 회귀 테스트를 추가했다. 생산 복사 로직 변경은 필요하지 않았다.

## TDD Evidence

1. 옵션 스타일 전파 테스트를 먼저 추가하고 실행했다.
   - `choice-source`: `textBold`와 `backgroundColor` 누락으로 실패
   - `ranking-source`: 일반·기타 ranking 옵션 모두 스타일 누락으로 실패
2. 최소 전파 구현 뒤 두 소스 테스트는 22개 전체 통과했다.
3. 모바일 카드 Bold 테스트는 Bold 구현을 분리해 다시 RED를 확인했다.
   - `Expected element to have class: font-bold`
4. 모바일 Bold 구현을 복원한 뒤 지정된 네 테스트는 39개 전체 통과했다.

## Verification

```text
pnpm exec vitest run \
  tests/unit/lib/choice-source.test.ts \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/utils/drag-copy-region.test.ts \
  tests/unit/survey/choice-table-response-mobile.test.tsx

Test Files  4 passed (4)
Tests  39 passed (39)

pnpm exec tsc --noEmit
exit 0
```

## Commit

`feat: 셀 스타일을 모바일과 파생 옵션에 연결`

## Follow-up Review Fix

- 모바일 카드의 라벨이 `mobileDisplay: 'header'` 셀에서 유래하면 Bold도 같은 header 셀에서 해석하도록 수정했다.
- 역방향 회귀 두 건을 추가했다: Bold header + unstyled choice는 Bold, unstyled header + Bold choice는 non-Bold이다.
- 카드 배경색 예외는 변경하지 않았다.

```text
Test Files  4 passed (4)
Tests  41 passed (41)
pnpm exec tsc --noEmit
exit 0
```
