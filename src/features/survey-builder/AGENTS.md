# 설문 편집기 — src/features/survey-builder

> `src/features/AGENTS.md` 의 디렉터리 구조에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 질문 유형·셀 타입·테이블 검증 규칙·행 반복은 `src/features/AGENTS.md`, 공통 규칙은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 디렉터리 구조

```
src/features/
│   ├── survey-builder/         # 설문 편집기 + 설문 목록 (195개) — importer 그래프의 닫힌 묶음대로 폴더화
│   │   ├── survey-list/        # 설문 목록 (survey-list-view 진입점, 티켓 08 — .pen FLOW 6)
│   │   │                       # 툴바(검색창 search-combobox — 검색 칩·자동완성 · 즐겨찾기 · 「# 태그」 tag-filter-menu · 상세 검색
│   │   │                       # · 목록 상태 세그먼트·자주 쓰는 태그 한 줄 quick-tag-row·정렬)·카드(별·태그 줄)·태그 창 tag-picker(+ tag-edit-panel) · 공용 태그 꼴 personal-tag-label (페이지네이션은 components/ui/list-pagination)
│   │   │                       # 거르기·정렬·페이지는 서버(read.listPage) — 조건의 정본은 주소(survey-list-url 이 주소 ↔ 조건 변환, 휴지통 적용 applyTrashAccess)
│   │   │                       # 표시 규칙만 순수 함수로 남는다(personal-tags·search-suggest) ·버튼 노출 근사(survey-list-capability — 판정은 서버)
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
│   │   ├── stores/             # survey-store(빌더 상태)·ui-store(빌더 UI 상태)·test-response-store(미리보기 응답)·preview-response-sources — 구 src/stores
│   │   ├── queries/            # TanStack Query 훅 use-surveys·use-survey-groups·use-survey-sharing·use-survey-participants·use-survey-guests·use-library·use-cell-library·use-survey-documents·use-survey-anchors·use-survey-suggestions(자동완성)·use-personal-marks(별·태그 — 마지막 의도 낙관적 갱신) — 구 src/hooks/queries
│   │   ├── lib/                # changeset·diff-payload·persist-question·variable-generator·saved-question-branch-logic·cell-formula/gating-diagnostics — 구 src/lib/survey-builder
│   │   ├── utils/              # option-value-remap·prune-sum-constraints·input-mode(숫자 모드↔입력 형식 전환)
│   │   └── (루트)               # 복수 묶음이 쓰는 공용 필드 위젯(input-format-select·option-text-settings-editor·text-validation-fields·placeholder-field 등) + app 이 직접 여는 모달·패널
│   │                           # 폴더 위상: hooks ← lookup ← condition ← table-editor ← question-edit ← question-list (DAG, 순환 없음)
```
