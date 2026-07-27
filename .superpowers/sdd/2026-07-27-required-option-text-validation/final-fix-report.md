# 필수 옵션 상세기입 최종 수정 보고서

## 상태

`DONE`

- 시작 HEAD: `cca6f33581b000597c2799570c51fa6c938e216d`
- 범위: 최종 리뷰 P1 2건, P2 3건
- DB 스키마, 응답 payload 형식, 엑셀·SPSS export 형식 변경 없음
- 기존 미커밋 변경은 수정·삭제·stash·reset하지 않았고, 특히
  `survey-response-flow.tsx`의 기존 폭/버튼 라벨 변경은 최종 커밋에서 제외한다.

## 수정 결과

### P1: 전체 제출의 필수 셀 상세기입

`useResponseLifecycle.handleSubmit`의 전체 경로 숫자 검증에 질문별 유효
`optionTexts`를 전달한다. 현재 단계의 live 검증을 통과한 유효한 필수 선택형 셀이
완료 시점에 다시 누락으로 판정되는 불일치를 제거했다.

### P1: 복구·관리자 응답의 루트 `__optTexts__`

`resolveEffectiveOptionTextsByQuestion`을 추가해 저장된 루트
`responses.__optTexts__`와 현재 Zustand 편집값을 질문별로 합친다.

- 저장값은 복구 세션과 관리자 수정 화면에서 검증에 사용한다.
- 현재 Zustand 값이 저장값보다 우선한다.
- 현재 값이 빈 문자열이어도 명시적인 삭제로 취급해 저장값을 되살리지 않는다.
- 이 유효 뷰를 질문 필수 검증, 현재 단계 필수 셀 검증, 전체 제출 필수 셀 검증이
  함께 사용한다.

### P2: 그룹 순위형

그룹 순위형 응답 객체를 flat 배열로 잘못 파싱하지 않고,
`collectRankingGroups`가 반환한 현재 살아 있는 그룹마다 해당 그룹의 응답 배열과
옵션을 대조한다.

- 한 활성 그룹의 선택된 상세기입이 공백이면 누락이다.
- 모든 선택 상세기입이 유효하면 통과한다.
- 상세기입 옵션을 선택하지 않은 그룹은 차단하지 않는다.
- 삭제된 phantom 그룹이나 알 수 없는 잔존 응답은 새 차단 조건으로 만들지 않는다.

### P2: table-source 순위 옵션 메타데이터

`resolveRankingOptionsFromCells`가 `allowTextInput`과
`textInputPlaceholder`를 일반/기타 파생 옵션 모두에 보존한다.
`RankingDropdownStack`도 선택 옵션의 placeholder를 사용한다. 따라서 table-source
순위 옵션은 validator가 요구하는 상세 입력을 실제 화면에 렌더한다.

### P2: 동적 그룹 표시 조건

`collectVisibleTableCells`가 enabled 여부와 별도로
`DynamicRowGroupConfig.displayCondition`을 평가한다.

- 조건으로 숨은 그룹의 동적 행은 `__selectedRowIds` 잔존값이 있어도 제외한다.
- 같은 그룹의 `showWhenDynamicGroupId` 연결 행도 제외한다.
- 조건이 다시 참이 되면 선택된 동적 행과 연결 행을 기존과 같이 검증한다.
- 행·열 조건, 병합 숨김 셀, 미선택 동적 행의 기존 의미론은 유지한다.

## TDD RED / GREEN 증거

### 1. 전체 제출 optionTexts

RED:

```text
pnpm exec vitest run tests/unit/use-response-lifecycle.test.tsx
Test Files 1 failed
Tests 1 failed, 18 passed
실패: setNumericErrorStepIndex가 0으로 호출되어 유효한 상세기입도 완료 차단
```

GREEN:

```text
pnpm exec vitest run tests/unit/use-response-lifecycle.test.tsx
Test Files 1 passed
Tests 19 passed
```

### 2. 복구·관리자 유효 뷰와 빈 문자열 override

RED:

```text
pnpm exec vitest run \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey-response/required-option-text-flow.test.tsx
Test Files 2 failed
Tests 3 failed, 18 passed
실패: 유효 뷰 함수 없음 2건, 저장된 관리자 상세기입으로 제출 불가 1건
```

GREEN:

```text
pnpm exec vitest run \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey-response/required-option-text-flow.test.tsx \
  tests/unit/use-response-lifecycle.test.tsx
Test Files 3 passed
Tests 40 passed
```

### 3. 그룹 순위형

RED:

```text
pnpm exec vitest run tests/unit/required-option-text-validation.test.ts
Test Files 1 failed
Tests 1 failed, 13 passed
실패: 그룹 객체 안의 공백 optionText가 questionMissing=false
```

GREEN:

```text
pnpm exec vitest run tests/unit/required-option-text-validation.test.ts
Test Files 1 passed
Tests 14 passed
```

### 4. table-source 순위 메타데이터와 렌더 계약

RED:

```text
pnpm exec vitest run \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/survey/ranking-option-style.test.tsx
Test Files 2 failed
Tests 3 failed, 17 passed
실패: allowTextInput/textInputPlaceholder 유실 2건, 상세 입력 미렌더 1건
```

GREEN:

```text
pnpm exec vitest run \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/survey/ranking-option-style.test.tsx
Test Files 2 passed
Tests 20 passed
```

### 5. 동적 그룹 displayCondition

RED:

```text
pnpm exec vitest run tests/unit/numeric-validation.test.ts
Test Files 1 failed
Tests 1 failed, 34 passed
실패: 숨은 그룹의 stale 선택 행·연결 행에서 required-cells 1건 발생
```

GREEN:

```text
pnpm exec vitest run tests/unit/numeric-validation.test.ts
Test Files 1 passed
Tests 35 passed
```

## 최종 검증

집중 기능 회귀:

```text
pnpm exec vitest run \
  tests/integration/option-text-migration.test.ts \
  tests/unit/required-option-text-validation.test.ts \
  tests/unit/survey-response/required-option-text-flow.test.tsx \
  tests/unit/numeric-validation.test.ts \
  tests/unit/answer-validation.test.ts \
  tests/unit/use-response-lifecycle.test.tsx \
  tests/unit/survey/table-range-banner-filter.test.tsx \
  tests/unit/utils/ranking-source.test.ts \
  tests/unit/survey/ranking-option-style.test.tsx
Test Files 9 passed
Tests 168 passed
```

정적 검사:

```text
pnpm exec tsc --noEmit
exit 0

pnpm exec eslint --quiet [변경 production/test 12개 파일]
exit 0
```

전체 테스트:

```text
pnpm test
기본: Test Files 359 passed, Tests 3077 passed
격리 flaky: Test Files 1 passed, Tests 14 passed
exit 0
```

## 필수 table-source / grouped ranking 감사

- 비그룹 table-source ranking은 `resolveRankingOptions`가 파생한 동일 옵션을 렌더와
  상세기입 validator가 소비한다.
- grouped ranking은 `isQuestionAnswered`와 상세기입 validator가 모두
  `collectRankingGroups`의 살아 있는 그룹 집합을 사용한다.
- 그룹별 응답 충족 판정 후 선택된 옵션의 `optionText`를 같은 그룹 옵션에 대조한다.
- unselected 상세기입 옵션, phantom 그룹, hidden table cell은 새 차단을 만들지 않는다.
- table-source 파생 옵션의 상세기입 메타데이터가 renderer까지 도달하는 계약 테스트를
  추가했다.

## 우려 사항

기능상 우려 사항 없음. 모든 명령에서 공통으로 출력된 pnpm 설정 위치 경고는 기존
프로젝트 설정 경고이며 테스트·타입·린트 결과에는 영향을 주지 않았다.
