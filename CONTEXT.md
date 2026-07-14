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
보고서 분석과 통계 검정의 최소 단위. 문항 하나가 아니라 SPSS export column 하나에 대응하며, 복수응답·테이블·순위형 문항은 여러 분석 변수로 펼쳐진다. 식별의 정본은 설문 구조 좌표(문항 + 셀/옵션/순위 같은 하위 단위)이고, SPSS 변수명은 좌표에서 파생되는 표시 라벨이다 — 자동 발번 변수명은 문항 편집 시 재발번되므로 영속 식별자가 될 수 없다.
_Avoid_: 문항 단위 통계 변수, SPSS 변수명을 영속 식별자로 사용

**문항 블록 (question block)**:
분석 워크벤치 화면의 표시·오버라이드 단위. question 엔티티 하나에 속한 분석 변수들의 묶음이며, questionCode 접두사 그룹이나 빌더의 question_group과 다르다. 후속 주관식처럼 연관된 다른 문항은 블록에 포함하지 않고 표시조건 관계 신호로 곁에 연결만 한다.
_Avoid_: 코드 접두사 묶음(Q33*), 질문 그룹과 혼용

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

### 워크스페이스와 권한

**팀 (team)**:
정상 배치된 설문을 소유하는 최소 워크스페이스이자 기본 접근 경계. `연구1본부 - 1팀`처럼 전체 조직 경로를 이름에 포함하며 사용자는 복수 팀에 동시 소속될 수 있다.
_Avoid_: 별도 본부 엔티티, users.department, 조직명 문자열을 권한 판정에 사용

**시스템 전체 보기 (system workspace view)**:
슈퍼어드민이 모든 팀의 설문과 배치 대기 설문을 통합 조회·관리하는 가상 범위. 팀 엔티티가 아니므로 설문 소유, 멤버십, 설문 그룹, 해산, 재배치 목적지가 될 수 없으며 UI에서는 "메가리서치"로 표시한다.
_Avoid_: 메가리서치 팀, 기본 팀, 전체 팀

**팀 역할 (team role)**:
팀 멤버십에 붙는 역할 — 팀장(멤버 관리 가능)과 팀원. 팀에 게스트 역할은 없다(게스트는 설문 단위 개념).
_Avoid_: 팀 게스트

**슈퍼어드민 (superadmin)**:
팀 소속과 무관한 시스템 전역 관리자. 가입 승인, 팀 생성·배정을 전담하며 시스템 전체 보기와 모든 설문(private 포함)에 접근한다.
_Avoid_: 관리자(팀장과 모호), admin(기존 단일 admin 어감)

**승인 대기 (pending)**:
가입 직후 슈퍼어드민 승인 전의 사용자 상태. 세션을 발급하지 않으며 승인 시 active, 거절 시 rejected가 된다.
_Avoid_: 미인증(이메일 인증과 혼동)

**재직 중 (active)**:
정상 로그인할 수 있는 사용자 상태. 슈퍼어드민이 아닌 사용자가 소속 팀이 없으면 프로필 외 내부 설문은 초대 여부와 무관하게 보이지 않는다.
_Avoid_: 활성(화면 용어), 승인 완료

**일시 정지 (suspended)**:
로그인을 일시적으로 막되 팀 멤버십·설문 초대·소유권 기록은 유지하는 사용자 상태. 재직 중으로 복귀하면 기존 관계가 다시 적용된다.
_Avoid_: 퇴사, 비활성

**퇴사 (departed)**:
세션을 폐기하고 팀 멤버십과 설문 소유권을 정리해야 하는 사용자 상태. 과거 작성자·메일·감사 기록은 보존하며 일반 재활성화 대상이 아니다.
_Avoid_: 일시 정지, 계정 삭제

**재입사 처리 (rehire)**:
퇴사 사용자를 새 팀에 다시 배정하고 비밀번호 재설정을 거쳐 재직 중으로 전환하는 슈퍼어드민 작업. 이전 팀 멤버십과 설문 초대는 자동 복구하지 않는다.
_Avoid_: 재활성화, 퇴사 취소

**팀 미배치 사용자 (unassigned user)**:
재직 중이지만 active 팀 멤버십이 하나도 없는 일반 사용자. 승인 직후 팀 배정을 비웠거나 소속 팀이 해산되면 발생하며, 로그인과 프로필 접근만 가능하고 초대 설문을 포함한 모든 내부 설문 접근은 차단된다. 배치는 팀 상세의 팀원 추가 또는 재배치 센터의 팀 배정으로 한다.
_Avoid_: 게스트, 배치 대기 설문, 승인 대기

**팀원 추가 (team member pull)**:
팀 상세에서 팀장·슈퍼어드민이 미배치 사용자만 검색해 자기 팀으로 당겨오는 배치 경로. 추가 즉시 active 멤버십이 생겨 내부 설문 경로가 열린다. 타 팀 active 멤버 이동은 슈퍼어드민 전용이다.
_Avoid_: 타 팀 멤버 빼오기, 팀장에게 재배치 센터 접근 부여

**참여자 (collaborator)**:
설문 단위로 명시적으로 초대된 사용자. 편집자(editor)는 다른 사용자를 재초대할 수 있지만 열람자(viewer)는 재초대할 수 없으며, 어느 역할도 팀 멤버십을 만들지는 않는다.
_Avoid_: 공유 대상, 멤버(팀 멤버십과 혼동)

**게스트 (guest)**:
계정·이메일 없이 설문별 게스트 링크와 별도 비밀번호로 제한된 범위를 열람하는 외부 주체. 분석은 on/off, 현황은 표시 항목 화이트리스트로 허용한다. 다운로드(export)와 응답 상세·컨택 원본(연락처)·메일·편집은 항상 불가하다.
_Avoid_: 읽기 전용 계정, viewer 참여자, 게스트 사용자 역할

**현황 표시 항목 (overview display item)**:
게스트·viewer의 설문 현황 화면에 노출할 구성 요소의 화이트리스트(`viewerScopes.overviewComponents`) — 핵심 지표, 응답 추이, 상태별 분포, 문항별 이탈 구간, 진척률 리포트, 마스킹된 조사 대상 진척 리스트 등. 공유 설정에서 체크박스로 고르며 빈 목록은 현황 미노출을 뜻한다. 조사 대상은 마스킹본만 항목이 될 수 있고 연락처 원본은 항목이 될 수 없다. UI 표기는 「현황에서 보여줄 항목」.
_Avoid_: 현황 컴포넌트(개발 어휘 — UI 카피 금지), 차트 단위 분석 차단(분석은 on/off뿐)

**공개 범위 (survey visibility)**:
설문의 접근 규칙 — "팀 공개"(소속 팀 전원 + 참여자)와 "초대된 멤버만"(설문 소유자 + 참여자 + 슈퍼어드민, 팀장도 초대 없이는 불가).
_Avoid_: 공개 설문(응답 페이지의 isPublic과 별개 개념)

**capability**:
권한 검사의 최소 단위(설문 편집, 현황 열람, 다운로드 등). 역할은 capability 묶음 프리셋이며, 권한 분기는 역할명이 아니라 capability로 묻는다.
_Avoid_: 역할명 하드코딩 분기

**설문 그룹 (survey group)**:
팀 안에서 설문을 함께 정리하는 공용 폴더. 모든 active 팀원이 그룹 구조를 편집할 수 있지만, 설문 이동은 해당 설문의 편집 권한이 있는 사용자만 할 수 있다. 설문을 넣는 경로는 「설문 담기」(미분류 전용 일괄)와 카드 케밥 「그룹 이동」(단건, 미분류 선택 = 빼기) 둘이며 설문은 그룹 하나에만 속한다. 다른 팀으로 승계된 설문은 이전 그룹 관계를 끊고 새 팀의 미분류로 들어간다. 문항 편집기의 질문 그룹(question_groups)과는 전혀 다른 개념이다.
_Avoid_: 질문 그룹과 혼용, 폴더 권한(권한은 설문 단위 — 그룹은 시각적 묶음일 뿐)

**설문 소유자 (survey owner)**:
모든 설문의 발행·삭제·승계와 소유자 연동 연락처를 책임지는 현재 사용자. 최초 작성자 기록과 분리되며, 팀 전체 설문은 같은 팀의 active 멤버에게, 초대 전용 설문은 active 참여자에게 소유권을 이전할 수 있다.
_Avoid_: 방장, 최초 작성자, 설문 관리자

**소유자 연동 (owner-linked contact)**:
설문 문의·메일 회신 대상을 고정 주소가 아니라 현재 설문 소유자의 이메일로 해석하는 방식. 소유권 이전 후 발송되는 메일은 새 소유자에게 자동 연결되며 발신 주소와 과거 발송 기록은 바뀌지 않는다.
_Avoid_: 발신자 변경, 과거 캠페인 수정, 퇴사자 주소 복사

**승계 대기 (succession pending)**:
설문 소유자 퇴사 전에 후임자를 지정하지 못해 슈퍼어드민의 재배치가 필요한 상태. 승계가 끝날 때까지 일반 사용자의 소유권 변경은 중단된다. 팀 해산은 승계 대기를 만들지 않는다 — 해산 설문은 배치 대기로 수렴한다.
_Avoid_: 소유자 없음, 고아 설문, 자동 승계

**배치 대기 설문 (survey awaiting assignment)**:
기존 데이터 전환이나 팀 해산으로 아직 실제 소유 팀이 정해지지 않아 시스템 전체 보기에 보관된 설문. 슈퍼어드민만 내부 관리할 수 있으며 실제 팀을 지정하면 정상 배치 설문이 된다. 배치 대기 중에도 기존 공개 응답·게스트 열람·메일 발송은 계속된다.
_Avoid_: 기본 운영팀 설문, 메가리서치 팀 설문, 무소유 설문

**팀 해산 (team dissolution)**:
팀을 즉시 삭제하지 않고 보관(archived) 상태로 전환하는 수명주기. 경고 모달(영향 요약 + 팀 이름 입력)에서 확정하는 즉시 한 트랜잭션으로 팀은 archived, 팀원은 전원 미배치, 설문은 전부 배치 대기가 된다. 중간 상태와 해산 취소는 없으며 복구는 팀 재생성 후 재배치다. 전체 공유로 풀거나 설문 데이터를 삭제하지 않는다. (ADR-0011)
_Avoid_: 팀 삭제, 팀 데이터 삭제, 전체 공유 전환, 재배치 중(reassigning) 중간 상태

**재배치 센터 (reassignment center)**:
메가리서치(시스템 전체 보기) 카드로 진입하는 슈퍼어드민 전용 인박스. 미배치 사용자와 배치 대기 설문 두 탭으로 해산·전환 잔여물을 배치하며, 해산된 팀 이력은 지표로만 조회한다. 팀장은 접근할 수 없다.
_Avoid_: 팀장 공용 콘솔, teamId 딥링크 진입, 승계 대기 탭

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
