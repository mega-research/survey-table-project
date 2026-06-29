# 설문 응답 페이지 헤더 설정 설계

## 배경

기획자는 한글/엑셀로 작성된 오프라인 설문지의 상단 머리말을 웹 응답 페이지에서도 최대한 비슷하게 재현하길 원한다. 예시는 로고가 제목 좌우에 붙는 양식, 통계법 비밀보호 문구와 로고가 상단 양끝에 놓이는 양식, 로고가 없는 양식이 섞여 있다.

현재 응답 페이지는 `SurveyResponseFlow`에서 제목과 설명을 단순 헤더로 렌더링한다. 공개 응답 경로는 배포된 `survey_versions.snapshot`을 우선 사용하므로, 헤더 설정도 배포 시점에 고정되어야 한다.

## 목표

- 설문 편집자가 응답 페이지 헤더를 설문별로 설정할 수 있게 한다.
- 종이 설문지의 대표적인 머리말 패턴을 웹에서 자연스럽게 재현한다.
- ID 박스는 이번 범위에서 제공하지 않는다.
- 자유 배치 편집기는 만들지 않고, 프리셋 중심으로 깨지기 어려운 설정만 제공한다.
- 모바일에서는 종이 양식 좌우 배치를 억지로 유지하지 않고 읽기 쉬운 세로 배치로 전환한다.

## 헤더 프리셋

헤더 스타일은 세 가지로 제한한다.

1. `기본형`
   - 로고와 통계법 문구 없이 기존처럼 제목 중심으로 표시한다.
   - 헤더 설정이 없거나 레거시 스냅샷인 경우의 기본값이다.

2. `제목 옆 로고형`
   - 제목과 로고를 같은 행에 배치한다.
   - 로고 위치는 `왼쪽` 또는 `오른쪽`을 선택할 수 있다.
   - 제목은 남은 공간 중앙에 자동 정렬한다.

3. `양끝 정보형`
   - 상단 양끝에 통계법 비밀보호 박스와 로고를 배치하고, 제목은 그 아래 중앙에 표시한다.
   - 배치는 `통계법 왼쪽 + 로고 오른쪽` 또는 `로고 왼쪽 + 통계법 오른쪽`으로 좌우반전할 수 있다.
   - ID 박스는 표시하지 않는다.

## 편집 UI

설문 편집 페이지의 오른쪽 `설정` 패널에 `응답 페이지 헤더` 섹션을 추가한다.

기본 영역에는 다음만 노출한다.

- 헤더 스타일
- 로고 위치 또는 양끝 배치
- 로고 이미지 업로드/선택
- 양끝 정보형의 통계법 문구 편집

`세부 조정`은 접힌 영역으로 둔다. 기본값만으로도 어색하지 않아야 하며, 원본 양식에 맞추고 싶을 때만 펼쳐서 조정한다.

세부 조정 항목은 다음 프리셋 버튼으로 제공한다.

- 로고 크기: `작게`, `보통`, `크게`
- 제목 크기: `자동`, `보통`, `크게`
- 통계법 박스 폭: `좁게`, `보통`, `넓게`

슬라이더나 픽셀 입력은 이번 범위에서 제공하지 않는다. 편집자의 실수로 모바일 레이아웃이 깨지는 것을 막기 위해 허용 범위를 코드가 통제한다.

## 데이터 모델

현재 앱에서 사용 중인 `Survey` 객체와 가장 잘 호환되도록, 헤더 설정의 제품 인터페이스는 `survey.settings.responseHeader` 하나로 둔다. 빌더, 저장 payload, 배포 스냅샷, 응답 페이지 로더가 모두 이미 `Survey.settings`를 설문 표시 설정의 묶음으로 다루기 때문이다.

- 앱 타입은 `src/types/survey.ts`의 `SurveySettings`에 `responseHeader?: SurveyResponseHeaderConfig`를 추가한다.
- 빌더 UI는 `updateSurveySettings({ responseHeader })`만 호출한다.
- diff 저장 payload는 기존처럼 `metadata.settings` 전체를 보낸다.
- 배포 스냅샷은 `snapshot.settings.responseHeader`에 같은 구조를 포함한다.
- 응답 페이지와 admin preview는 `loadedSurvey.settings.responseHeader`만 읽는다.

DB 저장 방식은 이 제품 인터페이스의 구현 세부사항으로 둔다.

- DB JSONB 타입 `SurveyResponseHeaderConfig`는 `src/db/schema/schema-types.ts`에 둔다.
- `src/db/schema/surveys.ts`에는 top-level 컬럼 `responseHeader: jsonb('response_header').$type<SurveyResponseHeaderConfig>()`를 추가한다.
- 서비스 읽기 경계에서 `surveys.responseHeader`를 `survey.settings.responseHeader`로 조립한다.
- 서비스 저장 경계에서 `surveyData.settings.responseHeader`를 `surveys.response_header`에 저장한다.

즉, `Survey` 객체에 별도 top-level `responseHeader`를 추가하지 않는다. DB에도 `settings` JSONB 덩어리를 새로 만들지 않는다. 저장소 형태는 분리하되, 앱 내부에서는 기존 설문 설정과 같은 위치인 `Survey.settings`에 붙여 호환성을 유지한다.

개념 타입은 다음과 같다.

```ts
type SurveyResponseHeaderConfig = {
  style: 'plain' | 'logo-title' | 'official-band';
  logo?: {
    imageUrl: string;
    altText?: string;
    size: 'sm' | 'md' | 'lg';
  };
  logoTitle?: {
    logoPosition: 'left' | 'right';
  };
  officialBand?: {
    arrangement: 'stat-left-logo-right' | 'logo-left-stat-right';
    statisticNotice: {
      title: string;
      body: string;
      width: 'sm' | 'md' | 'lg';
    };
  };
  titleSize: 'auto' | 'md' | 'lg';
};
```

기존 설문 row와 기존 배포 스냅샷에는 `responseHeader`가 없다. 이 경우 `{ style: 'plain', titleSize: 'auto' }`로 취급해 기존 설문의 응답 페이지가 시각적으로 바뀌지 않게 한다.

DB 컬럼은 nullable로 둔다. 기본값을 DB에 박지 않고 서비스/렌더링 경계에서 기본형 fallback을 적용해, 기존 설문 row와 기존 배포 스냅샷이 데이터 마이그레이션 없이 동작하게 한다.

## 저장과 배포

- 빌더 스토어의 기본 설문 설정에 `responseHeader` 기본값을 추가한다.
- 설문 저장 서비스는 `settings.responseHeader`를 `surveys.response_header`에 영속화한다.
- 배포 스냅샷 빌더는 `responseHeader`를 `snapshot.settings`에 포함한다.
- 공개 응답 조회는 스냅샷의 `responseHeader`를 우선 사용한다.
- 스냅샷에 값이 없는 이전 배포본은 기본형 헤더로 처리한다.
- `getSurveyWithDetails`, `getSurveyForResponse`, `use-survey-loader`의 스냅샷 복원 경로 모두 `Survey.settings.responseHeader` 위치로 값을 맞춘다.
- 설문 복제는 원본의 `responseHeader`를 복사한다.

헤더 설정은 중첩 구조이고 프리셋별 하위 설정이 서로 다르므로 개별 컬럼으로 분해하지 않는다. 다만 JSONB 내부 값은 discriminated union에 가깝게 유지해서 `style`별 필수 하위 설정을 타입으로 강제한다.

## 렌더링

응답 페이지에는 별도 컴포넌트 `SurveyResponseHeader`를 만든다. 이 컴포넌트는 `survey.title`, `survey.description`, `survey.settings.responseHeader`, 진행률 표시 여부를 받아 헤더 전체를 렌더링한다.

데스크톱 규칙:

- `기본형`: 제목과 설명을 중앙 또는 기존 흐름에 맞게 표시한다.
- `제목 옆 로고형`: 로고와 제목을 2열 그리드로 배치한다.
- `양끝 정보형`: 통계법 박스와 로고를 양끝에 배치하고 제목을 아래 중앙에 둔다.
- 진행률과 현재 단계 표시는 헤더 하단에 유지한다.

모바일 규칙:

- 좌우 2열 배치를 유지하지 않는다.
- 로고, 통계법 박스, 제목을 세로로 쌓는다.
- 제목은 긴 한글 문장이 줄바꿈되어도 버튼이나 진행률과 겹치지 않아야 한다.

## 통계법 기본 문구

통계법 문구의 기본값은 다음으로 제공하되, 편집자가 수정할 수 있다.

- 제목: `통계법 제33조(비밀의 보호)`
- 본문: `통계의 작성 과정에서 알려진 사항으로서 개인이나 법인 또는 단체의 비밀에 속하는 사항은 보호되어야 한다.`

## 테스트

- 스냅샷 빌더가 `responseHeader`를 보존하는 단위 테스트를 추가한다.
- 공개 응답 조회가 레거시 스냅샷에서 기본형 헤더로 fallback하는 테스트를 추가한다.
- `SurveyResponseHeader`는 프리셋별 렌더링, 좌우반전, 모바일 세로 배치의 기본 클래스를 테스트한다.
- 설정 패널은 헤더 스타일 선택에 따라 필요한 입력만 노출되는지 테스트한다.

## 범위 제외

- ID 박스 렌더링
- 자유 드래그 배치
- 픽셀 단위 크기 입력
- 헤더별 배경색/테두리 색상 커스터마이징
- 설문별 여러 로고 슬롯
