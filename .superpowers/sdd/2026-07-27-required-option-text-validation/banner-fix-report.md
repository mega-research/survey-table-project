# 필수 옵션 상세기입 오류 배너 후속 수정 보고서

- 상태: DONE
- 기준 커밋: `b4800c9b4a698296b06247233507806363d2683f`
- 작업일: 2026-07-27

## 원인

필수 옵션의 상세기입 누락은 `isQuestionAnswered`와 질문 하이라이트에는 반영됐지만,
현재 단계의 차단 이슈 맵에는 비테이블 질문 단위 이슈로 들어가지 않았다.
또한 choice-table-source는 `QuestionInput`의 조기 반환 경로를 사용해 이슈 배너를
렌더하지 않았다. 따라서 상세기입만 비어 있으면 다음/완료가 멈추면서도
`필수 응답이 비어있습니다` 배너와 `위치로 이동` 버튼이 나타나지 않았다.

랭킹의 `RANKING_OTHER_VALUE`는 일반 `allowTextInput` 옵션과 달리
`RankingAnswer.otherText`에 값을 저장하지만, 기존 순수 검증은 일반 옵션의
`optionText`만 검사했다.

## TDD RED

프로덕션 수정 전에 다음 명령을 실행했다.

```bash
pnpm exec vitest run \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey/ranking-option-style.test.tsx \
  tests/unit/survey-response/required-option-text-flow.test.tsx
```

결과:

- 테스트 파일: 3개 실패
- 테스트: 34개 중 12개 실패, 22개 통과
- 실패 분류:
  - 순수 검증의 상세 입력 타깃 누락 또는 랭킹 기타 오판정: 7개
  - 랭킹 상세 입력 DOM 타깃 속성 누락: 2개
  - 모바일 다음/완료 및 choice-table 초기 응답 배너 누락: 3개

## 구현

- 순수 검증이 누락된 상세 입력의 안정 타깃 ID와 소유 셀 ID를 반환하도록 확장했다.
- 필수 질문 단위 상세기입 누락을 `required-detail` 차단 이슈로 현재 단계 이슈 맵에 넣었다.
- 테이블 셀 이슈는 일반 필수 미입력과 상세기입 누락 셀 ID를 `Set`으로 합쳐 중복을 제거했다.
- 공용 `ValidationIssueBanner`와 `scrollToIssue`를 추가했다.
  - 이동 우선순위: 실제 상세 입력 → 테이블 셀 → 질문 카드
  - 테이블은 기존 배너 위치와 모바일 드릴다운 이동 동작을 유지한다.
  - 비테이블과 choice-table-source는 질문 입력 래퍼에서 같은 배너를 사용한다.
- `OptionTextInput`과 랭킹의 `otherText`/`optionText` 입력에
  `data-option-text-target-id`를 부여했다.
- 필수 랭킹 질문과 필수 랭킹 셀에서 `RANKING_OTHER_VALUE`는
  `otherText.trim()`으로 판정하고, 해당 분기에서 `optionText`를 요구하지 않는다.
- `survey-response-flow.tsx`의 사용자 소유 제출 문구 변경과
  `mobile-bottom-nav.tsx` 변경은 보존했으며, 필요한 검증 훙크만 추가했다.

## 최종 검증

### 직접 관련 테스트

```bash
pnpm exec vitest run \
  tests/unit/numeric-validation.test.ts \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey/ranking-option-style.test.tsx \
  tests/unit/survey-response/required-option-text-flow.test.tsx \
  tests/unit/survey/table-error-banner-jump.test.tsx \
  tests/unit/survey/table-range-banner-filter.test.tsx
```

- 테스트 파일: 6개 통과
- 테스트: 77개 통과

### 집중 기능 스위트

```bash
pnpm exec vitest run \
  tests/unit/survey-response \
  tests/unit/survey \
  tests/unit/answer-validation.test.ts \
  tests/unit/numeric-validation.test.ts \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/use-response-lifecycle.test.tsx
```

- 테스트 파일: 51개 통과
- 테스트: 516개 통과

### 타입 검사

```bash
pnpm exec tsc --noEmit
```

- 통과

### 범위 ESLint

수정한 소스와 테스트 파일만 대상으로 실행했다.

- 오류: 0개
- 경고: 5개
- 경고는 기존 훙크의 `no-explicit-any` 5건이다.
  - `interactive-table-response.tsx`: 4건
  - `use-response-lifecycle.ts`: 1건

### 전체 테스트

```bash
pnpm test
```

- 기본 전체 실행: 테스트 파일 359개, 테스트 3,085개 통과
- flaky 격리 실행: 테스트 파일 1개, 테스트 14개 통과
- 총 테스트: 3,099개 통과

## 보존·호환성

- 카드 하이라이트와 모바일/데스크톱 렌더 분기는 유지했다.
- 응답 payload, DB, 분석, SPSS/엑셀 export 형식은 변경하지 않았다.
- 숨은 셀과 조건부 미노출 셀은 기존 visible-cell 필터를 계속 사용한다.
- 테이블 질문은 공용 배너 컴포넌트를 내부에서 한 번만 사용하며 질문 래퍼 배너를 중복 렌더하지 않는다.

## 우려 사항

- 기능상 미해결 사항은 없다.
- 범위 ESLint의 기존 경고 5건과 pnpm 설정 경고는 이번 수정 범위 밖이라 유지했다.
