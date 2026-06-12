# Survey Table Project — 도메인 언어

설문 빌더·응답·운영 플랫폼의 도메인 용어집. 아키텍처 리뷰와 설계 대화에서 이 용어를 정본으로 쓴다.

## Language

### 테이블 질문 평가

**테이블 셀 의미론 (table-cell-semantics)**:
테이블 셀 응답값의 해석·판정 규칙 전체 — optionId 언랩, optionId→옵션 value 해석, input 값 정본화(`String(v).trim()`), 응답됨 판정, 기대값 매칭, isHidden 정책. `src/utils/table-cell-semantics.ts` 한 곳이 소유한다.
_Avoid_: 셀 값 추출 로직, 셀 타입 switch

**검증 규칙 (table validation rule)**:
테이블 응답에 대한 분기 규칙. 5종 수량자(exclusive-check / any-of / all-of / none-of / required-combination)를 가지며, 이 수량자 어휘는 검증 규칙 interface 소유다 — 셀 의미론으로 내리지 않는다.
_Avoid_: 테이블 밸리데이션, 검증 조건

**표시조건 (displayCondition)**:
질문·그룹·행·열·동적 그룹의 노출 여부를 결정하는 조건 그룹(AND/OR/NOT + 조건 목록). 테이블 검사 시 checkType(any/all/none) 어휘를 쓰며 검증 규칙의 5종 수량자와 별개 interface다.
_Avoid_: 분기 조건(분기는 검증 규칙의 action 쪽 어휘)

**응답됨 (answered)**:
셀에 유효한 응답값이 존재하는 상태. 두 변종이 실재한다 — 인터랙티브 타입 게이트 판정(매칭의 기본값)과 타입 불문 값 존재 판정(exclusive-check 전수 스캔). 둘은 다른 판정이며 함수 이름으로 구분한다.
_Avoid_: 체크됨(checkbox 한정 어감), 입력됨

**행 완료 판정 (row completion)**:
테이블 행의 모든 answerable 셀이 응답됐는지의 판정 (`table-row-completion.ts`). isHidden 셀과 radioGroup 버킷을 제외/그룹 단위 처리한다. 셀 의미론과 같은 개념을 공유하지만 빈 배열·공백 처리의 의미가 달라 별도 module로 둔다.

**branch-eval**:
분기 평가의 leaf 의존 — `BranchEvalCtx`, `emptyBranchEvalCtx`, `evaluateNumericComparisonV2`. 셀 의미론과 branch-logic이 모두 의존하는 순환 없는 최하층(`src/utils/branch-eval.ts`).

### 동적 행과 응답 쓰기

**동적 행 파이프라인 (dynamic-row pipeline)**:
동적 행 기능의 단일 진입점 — 선택 상태 → 가시 행 필터링(동적 그룹 제외 + rowspan 재계산) → 셀렉터 배치·grid 좌표 → 행 완료 맵까지의 호출 순서와 배선. `src/hooks/use-dynamic-rows.ts`(facade)가 소유하고, 내부 두 훅(use-dynamic-row-state, use-dynamic-row-layout)은 implementation이다. displayCondition 평가는 호출자 소유로 결과만 주입받는다.
_Avoid_: 레이아웃 훅 무리, 동적 행 로직

**질문 응답 쓰기 채널 (question response writer)**:
"최신 응답 읽기 → 패치 병합 → 커밋" 의식의 단일 거처(`src/hooks/use-question-response-writer.ts`). 테스트 모드(test-response-store)와 실응답 모드(value/onChange)라는 두 adapter가 이 seam을 만족한다. 새 응답 쓰기 지점은 isTestMode 분기를 만들지 말고 이 채널을 경유한다.
_Avoid_: 모드 분기, isTestMode 스위치

**SurveyDiffPayload 조립 (diff-payload)**:
changeset snapshot + 현재 설문 상태 → 저장 payload 변환 규칙(`src/lib/survey-builder/diff-payload.ts`, 순수 함수). dirtyIds = added∪updated 필터, 메타데이터 조건부 필드, reordered 전체 id 순서를 소유한다. use-survey-sync는 저장 오케스트레이션만 담당한다.
