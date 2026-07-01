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

### 응답 페이지 표시

**응답 페이지 헤더 (response page header)**:
공개 설문 응답 화면 상단에서 설문 제목, 로고, 통계법 문구 같은 설문지 머리말 요소를 표현하는 영역. 응답 진행률이나 질문 입력 영역과 별개의 설문 정체성 표현이다.
_Avoid_: 상단 장식, 레거시 헤더

**헤더 로고 (response header logo)**:
응답 페이지 헤더에 표시되는 기관·승인 로고 이미지. 질문 본문 이미지가 아니라 설문지 머리말의 정체성 표시 자산이며, 설문 이미지 자산으로 취급한다.
_Avoid_: 장식 이미지, 질문 이미지

**기본형 헤더 (plain response header)**:
로고와 통계법 문구 없이 제목 중심으로 표시되는 응답 페이지 헤더 프리셋. 기존 화면의 픽셀 보존 모드가 아니라 로고 없는 설문의 기본 표현이다.
_Avoid_: 레거시 호환 모드

### 질문 유형과 정규화

**질문 유형 레지스트리 (question type registry)**:
9개 질문 유형 리터럴의 런타임 SSOT(`src/types/question-types.ts`) — QUESTION_TYPES와 그룹 상수 4종(내장 테이블 / choice 그룹 / 옵션 목록 / 코드드 choice) + 멤버십 가드. 유형 멤버십 분기는 사설 Set·배열을 만들지 않고 여기를 경유한다. TS QuestionType과의 양방향 동치는 컴파일 프로브로 강제된다.
_Avoid_: 인라인 type 배열 비교, needsOptions류 사설 분기 함수

**질문 variant (QuestionVariant)**:
유형별 필드 소유를 박제한 판별 유니언(`src/lib/question/variants.ts`). 필드 타입의 단일 출처는 flat Question이고 variant는 Pick 합성이다 — flat으로의 단방향 할당 호환(`toFlatQuestion`)이 유지 축. 내장 테이블 capability는 table 전용이 아니라 radio·checkbox·ranking·table 4유형 공유다. TS variant ↔ zod 스키마의 키셋 동치는 드리프트 게이트가 지킨다. 분류 가드(`is*Question`, guards.ts)는 전부 "유형 멤버십"이다 — choiceGroups 데이터 실재로 분기하는 isGroupedChoiceQuestion(grouped 응답 shape 어휘)과 별개 개념이며, 후자를 멤버십 가드로 치환하면 required 영구 미충족/무력화 사고가 난다.
_Avoid_: 테이블 필드 = table 유형 전용이라는 가정, isChoiceGroupCapableQuestion(멤버십)과 isGroupedChoiceQuestion(데이터 실재)의 혼용

**질문 정규화 경계 (question normalize boundary)**:
스냅샷·export 등 신뢰 불가 직렬화 데이터가 `Question[]`로 들어오는 읽기 경계의 단일 거처(`src/lib/question/normalize.ts`). preserve(판별자만 검증, 무변형 passthrough + 관측)와 strict(zod parse + cross-type 오염 키 소거) 2모드. 경계 캐스트는 이 module 안 한 곳에만 존재한다 — 새 역직렬화 지점에서 `as unknown as Question[]`을 만들지 않는다.
_Avoid_: 역직렬화 단언, 호출처별 자가 검증

### 분석 보고서

**조사 아키타입 (survey archetype)**:
설문의 큰 조사 목적. 실태조사, 만족도조사, 성과조사, 인식조사처럼 분석 추천의 기본 방향을 정하는 분류이며 개별 문항의 역할이 아니다.
_Avoid_: 조사 유형 태그를 문항 역할로 쓰기

**분석 변수 (analysis variable)**:
보고서 분석과 통계 검정의 최소 단위. 문항 하나가 아니라 SPSS export column 하나에 대응하며, 복수응답·테이블·순위형 문항은 여러 분석 변수로 펼쳐진다.
_Avoid_: 문항 단위 통계 변수

**변수 프로파일 (variable profile)**:
분석 변수의 역할, 도메인, 척도, 값 타입, 응답 형태, 시간 성격, 분석 용도를 묶은 해석 메타데이터. 자동 추론 초안으로 만들되 사용자가 검토·수정할 수 있어야 한다.
_Avoid_: role 단일 enum, 문항 태그

**분석 레시피 (analysis recipe)**:
조사 아키타입과 변수 프로파일 조합에서 추천되는 분석 묶음. 차트, 기술통계, 교차분석, 집단 차이 확인, AI 초벌 해석의 기본 구성을 함께 정한다.
_Avoid_: 문항별 하드코딩 추천

**문항 요약 (question summary)**:
단일 문항 또는 문항 블록의 현황을 설명하는 분석. 빈도, 비율, 평균, 중앙값, Top2·Bottom2 비율처럼 보고서 본문에 바로 쓰는 기술통계를 포함한다.
_Avoid_: 통계 검정까지 포함한 요약

**집단 차이 분석 (group difference analysis)**:
segment 변수로 나눈 집단 사이에 outcome/evaluation/barrier 계열 변수가 다르게 나타나는지 확인하는 분석. 보고서 UI에서는 "차이 없음/차이 가능성/차이 뚜렷함/표본 부족"처럼 해석 중심으로 표현한다.
_Avoid_: 검정명 중심 메뉴

**AI 초벌 해석 (AI draft interpretation)**:
계산된 분석 결과와 주의사항을 근거로 작성되는 보고서 문장 초안. 원본 응답 JSONB를 직접 해석하지 않고 검증된 요약·교차표·집단 차이 결과를 입력으로 삼는다.
_Avoid_: AI 통계 판정, 원본 JSONB 자유 해석

**분석 설정 오버라이드 (analysis override)**:
자동 생성된 변수 프로파일·분석 레시피 위에 사용자가 분석 페이지나 리포트에서 덮어쓴 표시·지표·태그 설정. 원본 SPSS 메타데이터를 곧바로 바꾸는 것이 아니라 해당 분석 관점의 의도를 기록한다.
_Avoid_: 원본 태그 수정, 일회성 차트 상태

**표시조건 관계 신호 (display-condition relationship signal)**:
displayCondition의 sourceQuestionId와 requiredValues가 만들어내는 문항 간 의존 신호. 후속 문항의 분모, 필터 코호트, 추천 교차분석 후보를 정하는 강한 근거지만 인과관계 자체를 의미하지는 않는다.
_Avoid_: 분기 로직을 원인-결과 관계로 해석

### 쿼터

**쿼터 플랜 (quota config)**:
한 설문의 교차 셀별 목표 정의 전체 — 차원·카테고리·셀 목표·마감 문구·집행 스위치. `surveys.quotaConfig` JSONB 한 곳이 소유하며, 버전 스냅샷 밖이라 실사 도중 재배포 없이 편집된다. 카운트는 저장하지 않고 완료 응답에서 실시간 계산한다.
_Avoid_: survey_quotas 위성 테이블, 저장된 카운터

**쿼터 차원 (quota dimension)**:
쿼터를 나누는 축. 문항 1개에 바인딩하며 유형은 옵션형(보기값 집합)·숫자형(반열림 구간 min ≤ 값 < max). 성별·연령처럼 단일값 소스만 차원이 된다.
_Avoid_: 복수형 차원, 마진 합계 쿼터

**쿼터 셀 (quota cell)**:
차원들의 카테고리 조합과 목표 수. 셀 키는 categoryId를 차원 순서대로 이은 문자열(인덱스 아님 — 재정렬해도 목표 보존). "현재"는 완료 응답에서 실시간 집계하며 current ≥ target이면 "마감"이다.
_Avoid_: 인덱스 기반 셀 식별, 저장된 현재 수

**쿼터 마감 vs 쿼터마감 응답 (quota closed vs quotaful_out)**:
"마감"은 셀이 목표에 도달해 닫힌 상태(플랜 진척, 셀 수). `quotaful_out`은 마감된 셀에 걸려 종료된 응답의 처리 상태(사람 수)다. 서로 다른 층위이며 UI에서 섞지 않는다 — KPI 쿼터 카드는 진척(완료/목표·%·마감 셀 수)을, disposition은 별도로 표현한다.
_Avoid_: 마감 셀 수와 튕긴 응답 수 혼용
