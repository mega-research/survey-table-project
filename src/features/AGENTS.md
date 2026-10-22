# 프론트 기능 묶음 — src/features

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 디렉터리 구조

```
src/
├── features/                   # 프론트 기능 묶음 8개 (UI·훅·스토어·query 훅을 기능 단위로 — 레이어 규약 아님, FSD 아님)
│   │                           # 의존 방향(ESLint): survey-builder → survey-response → question-renderer 단방향
│   │                           # operations·analytics·workspace·guest-console·fieldwork-console 은 각각 독립(서로 import 0)
│   │                           # builder → response 는 2건만 남았고 **둘 다 의도된 공유**다(옵션 텍스트 사이드카 저장소).
│   │                           # 인용값 계산이 양쪽에서 같은 입력을 봐야 해서 저장소를 하나로 둔 것 — 떼면 resetResponseState 의 원자적 리셋이 갈린다
│   │                           # UI 가 서버에서 가져올 수 있는 건 없다 — @/server 전면 금지(타입 포함), 모양은 @/shared/contracts 로
│   │                           # 루트 잔류 기준: ① 복수 하위 묶음이 소비하는 공용 조각 ② app 라우트가 직접 여는 진입점만 — 단일 묶음만 소비하면 그 묶음 안으로
│   │                           # 루트 개수는 목표가 아니라 이 기준의 결과다(2026-08-25 전수 실측: 72파일 중 이동 1건). 새 묶음의 진입점은 폴더 안(table-editor 방식), 기존 group-manager·condition-card 는 유지
│   ├── survey-builder/         # 설문 편집기 + 설문 목록 (150개) — importer 그래프의 닫힌 묶음대로 폴더화
│   │   ├── survey-list/        # 설문 목록 (survey-list-view 진입점, 티켓 08 — .pen FLOW 6)
│   │   │                       # 툴바(상태 칩·검색·정렬)·상세 검색 패널·카드 + 순수 파이프라인 (페이지네이션은 components/ui/list-pagination)
│   │   │                       # (survey-list-pipeline)·버튼 노출 근사(survey-list-capability — 판정은 서버)
│   │   │   └── groups/         # 설문 그룹 UI (티켓 12 — .pen FLOW 2): 관리 모달(CRUD·dnd 정렬)·
│   │   │                       # 담기 패널(미분류 전용)·삭제 확인·카드 케밥 이동 서브메뉴·그룹 화면 머리
│   │   ├── sharing/            # 공유 설정 모달 (share-settings-modal 진입점, 티켓 16 — .pen FLOW 4-2)
│   │   │                       # 입구는 둘 — 설문 카드 케밥 「공유」와 운영 헤더 「공유」(share-settings-button, 내부 운영 레이아웃이
│   │   │                       # 헤더의 shareAction 자리에 끼운다 — operations 는 이 묶음을 import 할 수 없다)
│   │   │                       # 공개 범위·참여자·클라이언트·실사 네 블록 + 소유권 이전(티켓 16·18·21·25)
│   │   │                       # 링크 패널은 access-link-panel 한 벌(`AccessLinkPanel({ surveyId, kind })`) — 클라이언트 블록은
│   │   │                       # 그것만 그리고(탭 칩 포함), 실사 블록은 「내부 실사원 | 외주」 세그먼트의 외주 쪽에 쓴다.
│   │   │                       # guests-block(게스트 계정 부여)은 **여는 화면이 없는 채로 남아 있다**(ADR-0029, 철거 전)
│   │   │                       # PRD 맵은 workspace 로 적었지만 입구가 설문 카드라 그 배치는 불가능하다
│   │                       # (두 묶음은 서로 import 금지 — 그룹 UI 가 survey-list/groups 에 사는 선례)
│   │                       # 후속 블록도 workspace 표면을 RPC 로 부르므로 feature import 는 안 생긴다
│   │   ├── question-list/      # 빌더 질문 목록 (sortable-question-list 진입점, question-test-card·group-header·duplicate-question-table(질문 복제 시 셀 참조·행 반복 참조 재배선))
│   │   ├── survey-document/    # 조사표 오서링 (survey-document-panel 진입점 + anchor-canvas 드래그) — app edit 페이지가 연다
│   │   ├── question-edit/      # 질문 편집 모달 (question-edit-modal → question-basic-tab·table-validation-editor·sum-constraint-editor)
│   │   ├── table-editor/       # 표 질문 편집기 (dynamic-table-editor 진입점 + row-repeat-settings-card 행 반복 설정 + staged-rows-settings-card 행 차례로 열기 설정) + hooks/·utils/(column-distinct-group 묶음 이름 열 일괄 지정 포함)·bulk-generator/
│   │   │   └── cell-editor/    # 셀 내용 모달 (cell-content-modal → *-cell-tab·cell-choice/gating-editor) + hooks/use-cell-form·utils/serialize-cell·utils/cell-rich-text(셀 본문 부분 강조 HTML)
│   │   ├── condition/          # 표시조건 편집 사슬 (question-condition-editor → condition-card → expression/value/numeric) + utils/
│   │   ├── lookup/             # LUT 선택·편집·CSV·보관함 (공용 리프 — condition·formula 가 소비)
│   │   ├── formula/            # 수식 편집기 (cell-editor·sum-constraint 양쪽이 소비)
│   │   ├── group-manager/      # 그룹 관리
│   │   ├── hooks/              # 빌더 전용 훅 (use-ensure-survey-in-db·use-survey-sync·use-builder-scroll)
│   │   ├── stores/             # survey-store(빌더 상태)·ui-store(빌더 UI 상태)·survey-list-ui-store(목록 필터·페이지)·test-response-store(미리보기 응답)·preview-response-sources — 구 src/stores
│   │   ├── queries/            # TanStack Query 훅 use-surveys·use-survey-groups·use-survey-sharing·use-survey-participants·use-survey-guests·use-library·use-cell-library·use-survey-documents·use-survey-anchors — 구 src/hooks/queries
│   │   ├── lib/                # changeset·diff-payload·persist-question·variable-generator·saved-question-branch-logic·cell-formula/gating-diagnostics — 구 src/lib/survey-builder
│   │   ├── utils/              # option-value-remap·prune-sum-constraints·input-mode(숫자 모드↔입력 형식 전환)
│   │   └── (루트)               # 복수 묶음이 쓰는 공용 필드 위젯(input-format-select·option-text-settings-editor·text-validation-fields·placeholder-field 등) + app 이 직접 여는 모달·패널
│   │                           # 폴더 위상: hooks ← lookup ← condition ← table-editor ← question-edit ← question-list (DAG, 순환 없음)
│   ├── question-renderer/      # 두 화면(빌더 미리보기·응답 페이지)이 함께 쓰는 렌더 조각 (102개) — 어떤 feature 도 import 하지 않는다
│   │   │                       # 질문 렌더러가 주지만 화면 공용 조각도 여기가 집이다 — 응답 헤더·루트 그룹 배지·검증 배너
│   │   │                       # 셀 본문 cell-text·순위형 클릭 ranking-click-select·보기 소스 표 셀 컨트롤 choice-table-cell-control/gated-cell·상세기재 줄 option-text-row·행 단위 그룹 카드 mobile-row-group-cards 도 여기 (2026-09-15 병합 — 스토어 직접 구독 대신 response-sources 주입 계약으로 옮겨 적었다)
│   │   │                       # pdf-page-view(조사표 한 쪽 렌더, 빌더·응답 공용) 도 루트
│   │   ├── cells/              # 표 셀 렌더러
│   │   ├── hooks/              # 표 레이아웃·동적 행·응답 쓰기 채널 훅 + 행 반복 use-row-repeat·행 차례로 열기 use-staged-rows·입력 형식 use-input-format-field·포커스 use-field-focus
│   │   └── utils/              # 표 그리드·모바일 표시 순수 계산 + renders-as-table·trailing-coalescer·effective-option-texts + anchor-geometry·anchor-outline(조사표 좌표) + ranking-mobile-sections(순위형 모바일 구간) + 입력 형식 파서 input-format·응답 품질 text-quality/cell-text-quality·단독 선택 exclusive-choice·순위 클릭 ranking-click·보기 그룹 외곽선/섹션 라벨 choice-group-outline/section-label · 모바일 보기 그룹 보기 모양 choice-group-mobile-view/section-view · 원본 한 줄 choice-group-original-line · 척도 막대 투영 choice-group-scale-bar(빌더 진단도 소비)·행별 척도 row-scale-bars (input-format·text-quality/cell-text-quality·exclusive-choice 는 builder·response 도 소비하고 나머지는 렌더러 전용 — 여러 feature 가 쓰는 순수 규칙은 방향상 가장 낮은 renderer 가 소유, 2026-09-15)
│   ├── survey-response/        # 응답 흐름 (flow·lifecycle·step-views) (38개) — 렌더러만 import
│   │   ├── hooks/              # 응답 플로우 훅 + use-client-signals·use-keyboard-open
│   │   ├── lib/                # version-rebase·answer/numeric/required-option-text-validation·admin-edit·quota-gate·hover-follow·split-viewport·format-normalize(제출 전 형식 정규화)·prior-answer-prefill(이월값 프리필·회수)·completion-screen(완료 화면 문구) (순수)
│   │   │                       # response-document-pane(응답 화면 좌측 조사표)·step-views/demand-checklist(판정 체크리스트) 도 이 묶음
│   │   ├── step-views/         # 스텝 단위 화면
│   │   └── stores/             # survey-response-store(실응답)·live-response-sources — 미리보기용 test-response-store 는 survey-builder/stores
│   ├── operations/             # 운영 콘솔 (88개) — contacts·profiles·report·quota·mail-campaign·mail-template·filters·demand(문항 수요 집계 표)
│   │   ├── hooks/              # use-auto-fade-message·use-search-params-mutator
│   │   └── queries/            # use-contacts·use-campaigns·use-file-cleanup
│   ├── analytics/              # 차트 및 리포팅 (23개)
│   ├── workspace/              # 워크스페이스 관리 (21개, 티켓 03 신설) — 사용자 관리 + 내 프로필 + 팀 관리 + admin 셸
│   │   │                       # + 재배치 센터. 진입점은 폴더 안
│   │   ├── admin-shell/        # admin 공통 셸 (티켓 08, .pen FLOW 6-1) — admin-shell 진입점(레이아웃이 연다)
│   │   │                       # + sidebar(로고·메뉴)·team-switcher(팀 전환+메가리서치)·sidebar-profile(프로필·로그아웃)
│   │   │                       # + sidebar-menu(순수 메뉴 판정 — 미배치는 프로필만)
│   │   │                       # + sidebar-group-tree(설문 그룹 트리 — 그룹 화면 입구, 티켓 12). 범위 전환 시 쿠키 기록
│   │   │                       # + 전체 캐시 무효화 + router.refresh 를 한 곳에서 처리한다
│   │   │                       # + sidebar-participation-tree(**실사팀 범위만** — 「설문 목록」·그룹 트리 대신 「참여 중」 →
│   │   │                       #   소유 팀 줄(?team=) → 폴더·미분류(?ungrouped=1). 수치는 participation-tree 순수 계산이
│   │   │                       #   본문과 같은 read.list 응답에서 센다, 0139)
│   │   ├── field-styles.ts     # 폼 필드 클래스 — 사용자 관리 모달 3종과 프로필·팀 모달이 함께 쓴다(루트 잔류 기준 ①)
│   │   ├── account-vocabulary.ts # 계정 표시 어휘(유형·상태 라벨·상태 배지) — 사용자 관리·팀 관리·실사 업체 셋이 쓴다
│   │   ├── account-query-keys.ts # 사용자·업체 쿼리 키 — 업체 mutation 이 양쪽 캐시를 접어야 해서 루트에 있다
│   │   ├── segmented-choice.tsx  # 세그먼트 컨트롤 — 계정 정보 편집 모달(user-edit-modal)이 쓴다. 계정 생성 모달의 유형
│   │   │                       # 세그먼트는 발급 유형이 내부 하나로 줄며 사라졌다(ADR-0029)
│   │   ├── fieldwork-orgs/     # 실사 업체 관리 (티켓 24, .pen FLOW 10-4) — **여는 화면이 없다**(ADR-0029: 사용자 관리의
│   │   │                       # 「실사 업체」 탭을 걷었다. 옛 실사 계정 모델의 화면이라 철거 전까지 파일만 남는다) — fieldwork-orgs-view
│   │   │                       # + fieldwork-org-card(카드·계정 명단·종료 확인) + fieldwork-org-form-modal
│   │   │                       # + queries/use-fieldwork-orgs. **사용자 관리를 import 하지 않는다** —
│   │   │                       # 저쪽이 이 묶음을 부르므로 방향이 한쪽이어야 한다(계정 발급 모달은 상위가 연다)
│   │   ├── user-management/    # user-management-view 진입점(20명씩 쪽 나눔 · 이름·이메일·팀 검색 · 소속 필터(활성 팀·미배치) · 유형·직책·상태 열 정렬 · 기본 보기는 퇴사자 제외, 상태 정렬·상태 필터로 포함 — 순수 규칙은 user-list-arrange) + user-create-modal + user-row-actions
│   │   │                       # + user-reset-password-modal · user-rehire-modal
│   │   │                       # + queries/use-users. 어휘·쿼리 키는 루트로 올라갔다(티켓 24)
│   │   │                       # 케밥이 여는 액션은 availableUserStatusActions(전이표)가 정한다 — 화면이 표를 따로 들지 않는다
│   │   ├── profile/            # profile-view 진입점 + queries/use-profile — **세 계정 유형 공통 화면**(.pen FLOW 3-2)
│   │   │                       # 게스트·실사도 여기로 들어오며 이름·아바타·비밀번호만 보인다(이메일·직책은 내부만)
│   │   ├── reassignment/       # 재배치 센터 (티켓 14 — .pen FLOW 8-2~8-4·9-2): reassignment-view 진입점
│   │                       # + survey-reassign-view(단건 8-4) + user-assign-modal(8-3) + survey-assign-bar(9-2)
│   │                       # + assignment-fields(목적지·소유자·공개 범위 공유 필드) + reassignment-vocabulary
│   │                       # + queries/use-reassignment
│   └── team-management/    # team-list-view·team-detail-view 진입점 + team-form-modal(생성·설정 겸용)
│   │                           # + member-add-modal(pull 검색) · team-member-row(직책 인라인·역할·제외)
│   │                           # + queries/use-teams. 목록은 슈퍼어드민, 상세는 팀 소속도 연다(.pen FLOW 7)
│   ├── guest-console/          # 클라이언트 열람 콘솔의 화면 조각 (티켓 22) — **두 입구가 함께 쓴다**(게스트 계정 `/guest` ·
│   │                           # 클라이언트 링크 `/client/<token>`, ADR-0029). 조각은 자기 주소를 모른다: 셸은 homeHref·trailing 을,
│   │                           # 서브헤더는 basePath·backHref 를 주입받는다 — guest-shell(헤더바)·guest-home-view(부여 설문 카드)
│   │                           # ·guest-survey-header(서브헤더+탭, 허용 탭만 그린다)·guest-contacts-table
│   │                           # (마스킹 표 — operations 표를 안 쓰는 유일한 자리)·guest-vocabulary(탭↔주소)
│   │                           # ·guest-tab-strip(클라이언트 링크 콘솔의 탭 줄 — 운영 콘솔 탭 스트립과 같은 얼굴, 허용 탭만).
│   │                           # **guest-shell·guest-survey-header 는 이제 게스트 계정 입구만 쓴다** — 링크 입구의 화면 머리는
│   │                           # 운영 콘솔 헤더로 옮겼다(2026-10-12). 본문(`app/_client-console`)과 어휘·표는 여전히 한 벌이다
│   └── fieldwork-console/      # 실사 콘솔 (티켓 25·26, .pen FLOW 10-1·10-2) — fieldwork-home-view 진입점
│                               # 초대 설문 표 + 팀장 전용 「업체 전체」 세그먼트
│                               # + fieldwork-header-bar(헤더)·fieldwork-survey-header(서브헤더+고정 탭 둘)
│                               # + fieldwork-contacts-table(원본 표 — 복호 평문·결과 기록·메모 저장)
│
```

---

## 질문 유형

| 타입          | 설명               | 주요 속성                                                                                                                                |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `text`        | 단답형 텍스트      | placeholder, defaultValueTemplate, inputType(숫자·형식 5종), emptyDefault, numberFormat, textValidation, inputRows, inputAutoGrow        |
| `textarea`    | 장문형 텍스트      | textValidation(최소 글자 수·의미 없는 입력 거부), inputRows(기본 4줄), inputAutoGrow                                                     |
| `radio`       | 단일 선택          | options, choiceGroups, allowOtherOption, optionsAlign                                                                                    |
| `checkbox`    | 복수 선택          | options, choiceGroups, allowOtherOption, minSelections, maxSelections                                                                    |
| `select`      | 드롭다운 단일 선택 | options, allowOtherOption                                                                                                                |
| `multiselect` | 드롭다운 복수 선택 | selectLevels (다단계 — 옵션 리스트는 selectLevels 내부 소유)                                                                             |
| `ranking`     | 순위형             | rankingConfig, optionsSource (manual\|table)                                                                                             |
| `table`       | 매트릭스/그리드    | tableColumns, tableRowsData, tableHeaderGrid, tableValidationRules, dynamicRowConfigs, rowRepeatConfig, stagedRowsConfig, sumConstraints |
| `notice`      | 안내문             | noticeContent, noticeBgColor, requiresAcknowledgment                                                                                     |

공통: `titleHtml`(제목 서식본 — 아래 "셀 본문 부분 강조"와 같은 규칙), `requiredMessage`(필수 미응답 문구), `hideTitle`, `pageBreakBefore`(수동 페이지 나눔), `answerQuote*`(이전 응답 인용), `displayCondition`.

- **그룹별 필수**: `ChoiceGroup.required`/`requiredMessage` (JSONB) — 미설정이면 질문 레벨 `required` 상속. 질문 필수여도 특정 그룹만 해제하거나 그 반대가 가능하며, 문구는 그룹 → 질문 → 기본 순 폴백.
- **최대 선택 개수 연동**: `maxSelectionsSource`(비그룹 checkbox 전용, 0130) — 숫자형 단답 문항의 응답값이 상한이 된다(「담당 팀 수만큼만 선택」). 참조값이 `unlimitedFrom` 이상이면 제한 없음, 못 읽으면(미응답·숨은 문항·1 미만) 고정 `maxSelections` 폴백. 판정은 `features/question-renderer/utils/dynamic-selection-limit.ts` 하나이고, 응답 화면·빌더 미리보기 디스패처가 `withResolvedMaxSelections` 로 상한을 갈아 끼워 렌더러는 고정 숫자만 읽는다. 참조 문항을 나중에 줄여 초과 상태가 되면 선택을 지우지 않고 `NumericIssue.kind: 'selection-max'` 로 「다음」을 막는다(클라이언트 전용). 발행 스냅샷에 실리므로 재발행해야 응답 페이지에 반영된다.
- **단독 선택 보기**: `QuestionOption.exclusiveChoice` · `TableCell.exclusiveChoice`(choice_opt 셀) — 「없음 · 해당 없음 · 모름」류. 체크박스 그룹 안에서 이것을 고르면 나머지가 풀리고 다른 보기를 고르면 이것이 풀린다(대칭, 단독끼리도 배타). 범위는 속한 그룹(일반 체크박스 문항은 문항 전체)이고, `exclusiveScope: 'table'` 이면 그 표의 모든 그룹을 비우고 필수·완료 판정도 표의 그룹 전부를 충족으로 본다(`hasTableExclusiveSelected`). 이 보기 하나로 최소 선택 수를 충족한 것으로 본다. 규칙은 `features/question-renderer/utils/exclusive-choice.ts` 하나이고 세 표면(일반 체크박스 · 레거시 보기 소스 표 · 보기 그룹 표)이 같이 쓴다. 명시 플래그만 동작하며 라벨 추정은 없다. JSONB 라 마이그레이션 없음. 분기 규칙의 `exclusive-check` 와 다른 개념 — CONTEXT.md "단독 선택 보기".
- **필수 마스터 전파**: 질문 편집 모달의 "필수 질문" 토글 조작 시 표의 인터랙티브 셀 필수(게이팅 셀은 `requiredWhenEnabled`)와 그룹 오버라이드를 일괄 재설정한다. 상속이 아닌 조작 시점 복사 — `docs/adr/0021` · CONTEXT.md "필수 마스터 전파".
- **입력 형식**: `inputType`(단답형·표 input 셀)·`textInputType`(보기 상세기재)은 `'text' | 'number'` 에 더해 형식 5종(`mobile` · `phone` · `biz_number` · `corp_number` · `email`)을 받는다. 값 목록은 `@/types/input-type` 이 SSOT 이고 zod 두 곳(`lib/question/schema.ts`, `server/survey-builder/domain/question.ts`)이 그 상수를 쓴다. **형식과 `number` 는 배타** — 형식을 고르면 숫자 서식·초기값·계산 검증이 붙지 않는다. 판정·정규화·실패 사유는 `@/features/question-renderer/utils/input-format` 의 `parseInputFormat` 하나에서 나오고, 차단은 `NumericIssue.kind: 'format'`(클라이언트 전용)이다. 타이핑 단계에서는 번호 형식 4종이 **숫자와 하이픈만** 받는다(`filterFormatTyping`, 훅 `useInputFormatField.handleChange` — 세 표면 공용, 이메일은 제외). 정돈(자동 하이픈)은 여전히 blur 때 한 번이다. 이메일은 타이핑을 막지 않는 대신 한글·전각 글자를 검사 사유 `non_ascii`(「이메일은 영문·숫자로만 입력해 주세요」)로 blur·다음에서 막는다 — 한글 조합 중 글자를 떨어뜨리면 자판이 고장 난 것처럼 보이고 붙여넣기에서 조용히 다른 주소가 되기 때문이다. **DB 마이그레이션 없음** — `input_type` 은 enum·CHECK 없는 text 컬럼이고 셀·보기 쪽은 JSONB 안이다. 자세한 규약은 CONTEXT.md "입력 형식" · `docs/adr/0023`.
- **순위형 입력 방식** `rankingConfig.inputMode` (JSONB, 마이그레이션 없음): 미지정·`'dropdown'` 이면 **기존처럼 순위마다 드롭다운**, `'click'` 이면 보기를 눌러 순위를 매긴다 — 비어 있는 가장 낮은 순위에 들어가고 다시 누르면 해제(뒤 순위 당김), 요약 줄에 `1순위 [보기번호]` 칩 + 순위초기화, 기타·상세기재 입력칸은 그 보기 행 안에 있고 순위가 매겨져야 활성화. 순수 로직은 `features/question-renderer/utils/ranking-click.ts`, UI 조각은 `features/question-renderer/ranking-click-select.tsx`. 표 소스는 내장 표의 `ranking_opt` 셀을 `TablePreview renderCell` 로 같은 얼굴로 그리고, 그룹별 순위는 그룹마다 요약 줄·표는 하나. 응답 모양(`{rank, optionValue}[]`)은 두 방식이 같아 저장·검증·내보내기 무변경. **표 안 ranking 셀은 항상 드롭다운이고, `allowDuplicateRanks` 가 켜지면 클릭을 골라도 드롭다운**이다(클릭으로는 같은 보기를 두 순위에 둘 수 없다).
- **좌측 고정 열**: `stickyColumnCount` — 표를 그리는 문항(table + 내장 테이블을 쓰는 radio/checkbox/ranking) 공용. NULL=자동 판정(왼쪽부터 연속된 정적 셀 열까지), 0=고정 안 함, 1~3=명시 지정. 기본을 0 이 아니라 NULL 로 둔 것은 회귀 방지다 — 0 이 기본이면 지금 고정된 표가 전부 풀린다. 명시 지정도 "스크롤할 열이 남는가"(지정값 ≥ 전체 열 수면 비활성)·"뷰포트 60% 를 넘지 않는가"(최소 1열 유지) 두 가드는 통과해야 한다. 또 고정 경계는 colspan 셀 한가운데를 자르지 않는다 — 본문이 `cellIndex < stickyColCount` 로 sticky 를 걸어, 여러 열을 덮는 셀이 sticky 가 되면 스크롤 시 뒤쪽 열 위를 덮으며 따라오기 때문이다(척도 응답이 colspan 으로 전 열을 덮는 표는 지정해도 라벨 열까지만 고정된다). 판정은 `features/question-renderer/utils/table-grid-utils.ts` 의 `computeStickyLeftColumns`. 가로(헤더) 고정은 옵션이 아니라 표 길이에 따른 자동 그대로다.

### 테이블 질문 셀 타입

- `text`: 텍스트 표시 / `image`: 이미지 / `video`: 비디오 링크
- `checkbox` / `radio` / `select`: 선택 입력
- `input`: 텍스트 입력 (inputType `number` 시 숫자만, 형식 5종 지정 시 형식 검사, 평문 모드면 `textValidation` 응답 품질 검사 — 최소 글자 수·의미 없는 입력 거부). `inputRows`(2 이상)면 여러 줄 입력칸이고, `inputAutoGrow` 를 켜면 입력한 만큼 칸과 행이 자란다(줄 수는 최소 높이, 켠 셀만 — 기존 고정 높이 보존, 숫자·형식 칸은 한 줄 고정, `hooks/use-auto-grow-textarea`). `inputWidth`(px)를 주면 셀 폭을 채우지 않고 그 너비로 고정되며 셀 가로 정렬을 따르고 오른쪽 단위 글자가 바로 뒤에 붙는다(레거시 보기 소스 표의 input 셀도 같음. 세로 카드 — 모바일 행 카드·드릴다운 카드 목록 — 만 `ignoreInputWidth` 로 무시하고, 드릴다운 안 원본 행 표·행별 원본 같은 px 격자는 적용). 셀 공통 `hideRightBorder` 는 응답 화면·미리보기에서 오른쪽 세로선을 안 그려 다음 셀과 한 칸처럼 이어 보이게 한다(빌더 편집 격자는 그대로) — 년 칸 | 월 칸 같은 "한 셀에 입력 둘" 요구는 이 둘로 푼다. 좌측 고정 열의 마지막 셀에 켜면 고정 영역과 스크롤 영역 사이 선도 사라지니 거기엔 쓰지 말 것. 격자선 클래스는 `features/question-renderer/utils/table-grid-utils.ts` 의 `getCellBorderClasses` 하나다. `piiEncrypted` 셀 플래그로 그 셀 응답값만 암호화 저장 (질문 단위 토글과 같은 규칙, 파기 스윕은 0085 — 이월 응답 파기 0095 와 합본한 현행 본문은 0100)
- `ranking`: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)
- `ranking_opt`: 이 셀이 질문 레벨 ranking 의 옵션 소스
- `choice_opt`: 이 셀이 질문 레벨 radio/checkbox 의 옵션 소스. 칸에 `optionCode`(변수번호, 예 `opt01`)를 적으면 일반 보기처럼 변수명 숫자 자리에 쓴다(`D2_1_opt01`·`D2_1_opt04_text`, 2026-10-20). 비우면 종전대로 순번 — 빌더 편집 폼에는 칸이 없다(`kept`)
- `calc`: 수식 기반 읽기 전용 계산 셀

> **중복 불가 묶음** (`cell.distinctGroup`, select 셀 전용, 2026-10-06): 같은 묶음 이름을 가진 선택 칸끼리는 같은 보기를 두 번 고를 수 없다. 묶음은 열·행 배치와 무관하게 **이름으로만** 정해지고(셀 편집 모달의 「중복 불가 묶음 이름」 + 「같은 열의 다른 선택 칸에도 적용」), 비교는 보기 값(`option.value ?? option.id`)이다 — 칸마다 보기 값이 다르면 아무것도 막지 않으므로 모달이 경고한다(`survey-builder/lib/distinct-group-diagnostics`). 다른 칸이 고른 보기는 목록에 남되 `disabled` 다(순위형 드롭다운과 같은 얼굴 — 목록에서 빼지 않는다). 이미 들어온 중복은 `NumericIssue.kind: 'distinct'`(클라이언트 전용, 고정 문구, 관리자 수정에서도 완화하지 않는다)가 막는다. 화면 비활성과 검증이 `features/question-renderer/utils/distinct-select-group.ts` 하나의 판정을 쓰고, 게이팅으로 닫힌 칸·병합에 가려진 칸(`isHidden` — 병합 저장이 덮인 칸에 내용을 통째 복사한다)은 구성원에서 뺀다. 행·열 표시 조건이나 동적 행 선택으로 지금 보이지 않는 칸도 뺀다(2026-10-12 — 숨은 칸의 값은 제출 때까지 응답에 남아 있어, 세면 보이지 않는 칸이 보기를 차지하고 「다음」을 막는다). 범위는 화면과 검증이 같아야 한다: 검증은 `collectVisibleTableCells` 의 칸 id 를, 화면은 `GatingTableCellsProvider` 의 `visibleCellIds`(그려지는 행의 칸)를 판정 함수의 `visibleCellIds` 로 넘긴다. 게이팅 평가용 셀 정의(`tableCells`)는 좁히지 않는다. 「닫혔는가」는 셀 게이팅 평가기에 **보기 선택 집합까지 넘겨** 판정한다(`collectTableChoiceSelection` — 빠뜨리면 choice-selected 로 열린 칸이 늘 닫힌 것으로 빠져 중복이 통과한다). 응답 화면은 묶음 구성원의 값과 그 게이팅이 읽는 키만 구독한다(`createKeyedValueSelector` + `gateSubscriptionKeys` — 컨트롤러의 컨트롤러·보기 선택 예약 키 포함). **테이블 유형 문항에서만 동작한다** — 보기·순위 문항의 내장 표(레거시 보기 소스 표)의 선택 칸은 `ChoiceTableCellControl` 로 그려지고 값이 `__optTexts__` 사이드카에 있어 비활성도 검증도 걸리지 않는다. 셀 필드 정책(`utils/table-cell-field-policy.ts`)에 폼 소유·보관함 제외(표 위치에 종속)로 적혀 있고, 셀 직렬화(`serialize-cell.ts`)는 폼 상태 · hydrate · select 조건부 spread 에서 다룬다. CONTEXT.md "중복 불가 묶음".

> **목록에서 찾기** (`cell.lookupSearch`, input 셀, 2026-10-21 — CONTEXT.md 「목록에서 찾기」가 정본): 칸을 누르면 설문 참조표(LUT) 목록이 선택 상자처럼 펼쳐지고 글자를 치면 좁혀지며, 고르면 이 칸과 **같은 표의** 지정 입력 칸(법인·사업자번호 등)을 한 번에 채운다. 목록 밖 값도 직접 적을 수 있고 저장되는 것은 글자뿐이라 저장·검증·내보내기 무변경, 마이그레이션 없음. 판정 `features/question-renderer/utils/lookup-search`(검색 정규화·채울 값 — 대상 칸 형식으로 정돈, 가려진 칸·잠긴 prefill 칸 제외), 여러 칸 쓰기는 `useCellResponse` 의 `patchValues` → `InputCell` 의 `onPatchValues`, 표 셀 정의는 `useGatingTableCells`, 참조표는 `useSurveyLookups`(빌더 편집 목록도 이제 공급한다). 빌더 설정은 `table-editor/cell-editor/lookup-search-fields`(채울 칸 이름은 `utils/lookup-fill-targets` — 같은 행 앞 글자 칸 첫 줄). 셀 필드 정책은 폼 소유·보관함 제외, 복제·행 반복의 칸 id 이동은 `remapCellRefs`. 평문 한 줄 칸·테이블 유형 문항 전용.

> **상세 기재 입력칸을 표 아래에** (`cell.optionTextBelowTable`, checkbox·radio·select 셀, 2026-10-13): 켠 칸은 「기타」처럼 상세 기재를 받는 보기를 골랐을 때 입력칸을 칸 안이 아니라 **표 아래 한 줄**(`행 제목 · 열 제목 | 입력칸`)로 그린다 — 연도 열처럼 칸이 좁으면 칸 안 입력칸은 라벨 칩과 안내 문구가 다 잘린다. 기본은 꺼짐(종전대로 칸 안). 옮기는 것은 그리는 자리뿐이고 값은 같은 `__optTexts__[보기 id]` 에 산다 — 저장·검증·내보내기 무변경. **격자 표(데스크톱·모바일 원본 표)에서만 옮긴다**: `InteractiveTableResponse` 가 격자 표를 `OptionTextBelowTableHost` 로 두르고 그 아래에 `OptionTextBelowTable`(가로 스크롤 컨테이너 밖)을 그리며, 칸은 `useOptionTextMovedBelowTable` 이 참일 때만 제 입력칸을 접는다. 호스트 없이 그려지는 모바일 카드·드릴다운·빌더 행 카드는 종전대로 칸 안이다 — 칸 옵션만 보고 접으면 입력칸이 어디에도 없게 된다. 라벨의 행 제목·열 제목은 「축 단위 카드」 투영(`buildColumnAxisCards`)을 그대로 쓰고, 보기 라벨이 있으면 뒤에 붙인다. 표 컴포넌트는 칸 값마다 다시 그려지지 않으므로 표 아래 줄이 선택된 (칸, 보기) 쌍을 글자 하나(`belowTableSelectionKey`)로 접어 따로 구독한다. 판정은 `features/question-renderer/utils/option-text-below-table.ts`. **테이블 유형 문항 전용** — 보기·순위 문항의 내장 표는 원래부터 표 아래 스택을 쓴다(`choice-table-response` 의 `tableBelowEntries`). 셀 필드 정책에 폼 소유로 적혀 있고 셀 직렬화는 폼 상태 · hydrate · 선택형 조건부 spread 에서 다루며, 모달 스위치는 상세 기재 보기가 있는 선택형 칸에서만 나온다. CONTEXT.md "표 아래 상세 기재".

> **셀 본문 부분 강조** (`cell.contentHtml`, 2026-09-10): 셀 편집 모달의 "셀 텍스트 내용"은 굵게·글자색·변수 삽입만 있는 축소 편집기(`components/ui/rich-text-editor/inline-rich-text-editor.tsx`, 스키마는 `inline-cell-extensions.ts`)다. **정본은 여전히 평문 `content`** 이고, 글자 일부에 색·굵게가 있을 때만 `contentHtml` 을 곁에 둔다(`serialize-cell.ts` 가 마크 유무로 판정, 마이그레이션 없음). 내보내기·SPSS 라벨·보기 라벨 파생·행 높이 측정·행 라벨 비교는 전부 평문을 보므로 무변경이고, 화면 표시만 `CellText`(`features/question-renderer/cell-text.tsx`) 가 서식본을 우선한다 — 토큰 치환은 `resolveCellTextHtml`, sanitize 는 `sanitizeCellHtml`(문단·줄바꿈·strong·span color 만). 셀 본문을 새로 그리는 자리를 만들면 평문을 직접 흘리지 말고 `CellText` 에 `html` 까지 넘길 것. 문단 = 평문의 한 줄이라 "첫 줄만 굵게"는 첫 문단에 걸린다.

> **드릴다운이 읽는 「모바일 카드 표시」** (2026-10-02): 입력 드릴다운(자동 드릴다운·선택 행 원본 보기의 목차)은 셀의 `mobileDisplay` 를 분류에 쓴다 — `classifyTable` 의 `readMobileDisplay`. ① 목차 열의 내용 빈 글자 셀이 숨기기(미지정 포함)면 **들여쓰기 표시 셀**: 덮인 행이 각자 섹션이 되고, 바로 윗행이 계산 셀만 있는 한 행짜리 섹션이면 **묶음 머리**(소계 값 + 하위 카드, 누르지 않음)가 된다. 판정은 저작 행 기준이라 하위가 전부 숨으면 머리도 빠진다. ② `inline`·`collapsed` 표시 셀은 **설명 셀**: 행 제목 후보에서 빠지고 목차 카드(자세히=첫 줄)·상세 화면(전문)에 설명으로 나온다. ③ 머리가 아닌 계산 전용 섹션은 값이 바로 보이는 요약 블록. 이전·다음 섹션 이동은 머리·요약을 건너뛴다. ④ 상세 화면(legacy matrix)의 **계산 칸은 제 열 자리에** 선다 — 열 묶음(`colGroups`)은 입력 열만 다루므로 `matrixDetailGroups`(mobile-table-drilldown)가 계산 칸을 제 열 앞의 마지막 입력 열이 속한 묶음에 열 순서대로 끼우고, 라벨은 입력 칸과 같은 규칙(모바일 라벨 → 엑셀 라벨 → 열 헤더)으로 읽는다. 전에는 묶음 뒤에 라벨 없이 몰려 「상용 · 임시」 아래에 와야 할 「합계」가 맨 끝에 이름 없이 나왔다. 쪼갠 섹션은 목차 열 출처 셀을 공유하므로 식별자는 `section.identity`(행 id)다 — `getSectionIdentity` 를 거치지 않고 `labelSourceCellId` 로 섹션을 찾으면 충돌한다. 보기 소스 표 드릴다운은 이 옵션을 켜지 않는다. 열 일괄 지정은 `survey-builder/table-editor/utils/column-mobile-display` 이고 셀 저장과 같은 커밋(`updateCell` 의 options)에 실린다. CONTEXT.md "들여쓰기 표시 셀"·"묶음 머리"·"설명 셀".

> 테이블-소스 choice 응답값은 `cell.id` 임. value-match displayCondition에 코드("3" 등)를 넣으면 영구 미스매치. `resolveChoiceOptions` 사용.

### 테이블 검증 규칙

- 분기형(`tableValidationRules`): `exclusive-check` 배타적 선택 / `required-combination` 필수 조합 / `any-of` 최소 하나 / `all-of` 모두 선택 / `none-of` 선택 불가
- 합계형(`sumConstraints`): 좌변(선택 셀 합계 또는 `leftExpr` 수식) `eq|ne|gte|lte|gt|lt` 우변(리터럴 또는 `targetExpr` 수식), `tolerance`는 eq/ne 전용 절대 오차. `aggregate: 'count'` 면 좌변이 **입력된 칸 수**다 — 인터랙티브 셀 전부가 대상이고, 합계와 달리 전부 비었거나 표를 건드리지 않아도 검사한다("10행 중 하나 이상 입력" — CONTEXT.md "입력된 칸 수")
- 검증 문구 자리표시자: 저작자 문구(합계 제약 `errorMessage` · 셀 수식 검증 `formulaErrorMessage` · 계산 칸 `calcValidation.errorMessage`)에 `{현재값}`·`{기준값}` 을 쓰면 검증에 쓴 실제 숫자로 바뀐다(`fillMessageValues`, numeric-validation). 쓰지 않으면 값은 드러나지 않는다 — 기준값 미노출은 기본 문구와 자리표시자 없는 문구에서 그대로다
- 차단 검증과 분기 규칙은 분리된 개념 — `docs/adr/0013-blocking-validation-separate-from-branch-rules.md` 참조

---

## 쓰기·검사 경계 규칙

CONTEXT.md 에서 옮겨 온 호출부 규칙이다 — 용어의 뜻은 CONTEXT.md 에, 지키는 방법은 여기에 둔다.

- **응답 쓰기는 질문 응답 쓰기 채널을 거친다** (CONTEXT.md 「질문 응답 쓰기 채널」). 새 응답 쓰기 지점은 모드 분기(isTestMode 스위치 등)를 만들지 말고 `features/question-renderer/hooks/use-question-response-writer.ts` 를 경유한다. 응답 원본이 주입돼 있는지·props 인지는 채널이 고르고, 호출자는 `mergePatch(patch)` 하나만 안다.
- **셀 편집 폼에서 필드 여럿을 함께 바꾸는 입력은 폼 동작으로** (CONTEXT.md 「셀 편집 폼 동작」). 그 규칙은 `cell-editor/utils/cell-form-transitions.ts`(순수 함수)가 소유하고 폼 훅 `use-cell-form` 이 `actions` 로 내놓는다 — 하위 탭은 setter 여럿을 이어 부르지 말고 이것을 부른다. 굵게 3지선다(굵게 없음 · 셀 전체 · 첫 줄만)는 공용 `CellStyleFields`(`table-editor/cell-style-fields.tsx`)의 조작이라 이 모듈로 옮기지 않는다.
- **잠금 면제는 `cellLockTemplate(cell)` 로 묻는다** (CONTEXT.md 「이월 값과 본문 프리필 토큰의 우선순위」). 표 input 셀의 「응답자가 고칠 수 있게」(`TableCell.prefillEditable`)를 켠 칸은 명단 값이 있어도 잠그지 않는다. 그래서 잠금 면제(형식 검사 · 응답 품질 검사 · 저장 경계의 형식 정돈)를 묻는 자리는 셀의 `defaultValueTemplate` 을 직접 읽지 말고 `features/question-renderer/utils/token-prefill.ts` 의 `cellLockTemplate(cell)` 을 거친다 — 직접 읽으면 고칠 수 있는 칸이 잠긴 칸처럼 검사를 면제받는다. 지금 이 판정을 지는 자리는 `numeric-validation`·`format-normalize`·`cell-text-quality` 다.
