# 설문 헤더 빌더 진입점 + 설정 모달 Design

> 작성일: 2026-06-29
> 선행: [응답 페이지 헤더 설계](2026-06-29-survey-response-header-design.md) — 본 문서는 그 후속 UX 개선이다.

## 배경 / 문제

응답 페이지 헤더 설정(`ResponseHeaderSettings`)은 현재 빌더의 **우측 설정 패널**(`survey-settings-panel.tsx`)에 들어 있다. 사용자는 이 위치가 어색하다고 피드백했다. 헤더는 공지사항과 함께 "설문 머리말"로 인식되는데, 설정이 우측 패널 깊숙이 있어 발견·접근이 불편하다.

## 목표

좌측 **질문 생성** 팔레트(공지사항 카드가 최상단에 있는 탭)의 맨 위에 **"설문 헤더"** 진입 카드를 추가한다. 클릭하면 설정 모달이 열리고, 모달 안에서 실시간 미리보기를 보며 헤더 프리셋을 조정한다. 우측 패널의 헤더 설정 섹션은 제거한다.

## 비목표 (YAGNI)

- 미리보기용 모바일/데스크탑 디바이스 토글
- 모달 전용 저장 버튼 (변경은 기존처럼 store 반영 후 상단 저장 버튼으로 영속화)
- 우측 패널과의 동기화 표시
- 응답 페이지 렌더링 로직 변경 (오른쪽 로고 배치 자체는 이번 범위 아님 — 사용자가 모달 미리보기로 직접 판단)

## 아키텍처

```
질문 생성 탭 (edit/page.tsx, create/page.tsx)
  └─ <ResponseHeaderSettingsModal />        # 신규, questionTypes.map() 바로 위
       ├─ 트리거 카드 (질문 아님 → addQuestion 미호출, 모달 open)
       └─ <Dialog>
            ├─ <SurveyResponseHeader … />    # 실시간 미리보기 (재사용, sideMeta 없음)
            └─ <ResponseHeaderSettings … />  # 기존 설정 컨트롤 (재사용)

우측 패널 (survey-settings-panel.tsx)
  └─ <ResponseHeaderSettings> 섹션 제거
```

### 신규 컴포넌트: `src/components/survey-builder/response-header-settings-modal.tsx`

자체완결 client 컴포넌트. 진입 카드 + Dialog + 미리보기 + 설정을 한 곳에 캡슐화한다. 두 페이지는 `<ResponseHeaderSettingsModal />` 한 줄만 배치한다.

**Props:** 없음 (store 직접 구독).

**상태/데이터:**
- `open`: 로컬 `useState` (모달 열림).
- `settings` / `title` / `description`: `useSurveyBuilderStore`의 `currentSurvey.settings`, `currentSurvey.title`, `currentSurvey.description`.
- `updateSurveySettings`: store 액션. 설정 변경 시 `updateSurveySettings({ responseHeader })` 호출.

**트리거 카드:** 질문-유형 카드(`Card` + 아이콘 + 라벨 + 설명)와 동일한 시각 언어를 쓰되, 전역 설정임을 나타내는 구분(질문 유형과 다른 accent 색 + 아이콘, 라벨 "설문 헤더", 설명 "응답 페이지 머리말 설정"). 클릭은 `setOpen(true)`만 한다 — `addQuestion`을 호출하지 않으며 `questionTypes.map()` 바깥의 별도 요소다(드래그/정렬 대상 아님).

**Dialog 내용:**
- 상단: `<SurveyResponseHeader title={title} description={description} responseHeader={settings.responseHeader} />` — `sideMeta` 미전달, 진행률 없음, 순수 헤더만.
- 하단: `<ResponseHeaderSettings settings={settings} onChange={(responseHeader) => updateSurveySettings({ responseHeader })} />`.

**의존성:** `useSurveyBuilderStore`, `ResponseHeaderSettings`, `SurveyResponseHeader`, `Dialog` (`@/components/ui/dialog`).

### 수정: `edit/page.tsx`, `create/page.tsx`

질문 생성 탭의 `{questionTypes.map(...)}` 바로 위에 `<ResponseHeaderSettingsModal />`를 배치한다. import 추가.

### 수정: `survey-settings-panel.tsx`

Task 4에서 추가했던 `<ResponseHeaderSettings>` 섹션과 관련 import를 제거한다.

## 데이터 흐름

단일 출처(store)로 미리보기와 설정이 동기화된다. 설정 변경 → `updateSurveySettings` → store 갱신 → 모달 내 미리보기 `SurveyResponseHeader` 즉시 재렌더. 별도 로컬 설정 상태/동기화 없음.

## 엣지케이스

- `settings.responseHeader`가 없을 때(레거시): `normalizeResponseHeaderConfig`가 기본형으로 정규화 → 모달·미리보기 안전.
- 로고 미업로드: `HeaderLogo`의 점선 플레이스홀더가 미리보기에 표시 → 로고 위치(좌/우)가 이상한지 즉시 확인 가능.
- 저장: 모달은 변경 즉시 store 반영. 영속화는 기존 빌더 상단 저장 버튼 흐름과 동일(설정 패널과 같은 의미론) — 신규 영속화 로직 없음.

## 테스트

신규 `tests/unit/survey/response-header-settings-modal.test.tsx`:
1. 트리거 카드 클릭 시 모달이 열린다.
2. 모달 안에 미리보기(`SurveyResponseHeader`)와 설정 컨트롤이 함께 렌더된다.
3. 설정에서 프리셋을 바꾸면 `updateSurveySettings`가 호출되고 미리보기가 갱신된다 (store mock으로 확인).

기존 유지: `response-header-settings.test.tsx`(설정 단위), `survey-response-header.test.tsx`(렌더). 설정 패널 섹션 제거 후에도 패널이 정상 렌더되는지 기존 패널 테스트(있으면)로 커버.

## 영향 / 호환성

- 저장·조회·스냅샷·응답 렌더링 등 백엔드/데이터 경로는 변경 없음 — 순수 빌더 UI 재배치.
- `ResponseHeaderSettings`·`SurveyResponseHeader` 컴포넌트는 시그니처 변경 없이 재사용.
