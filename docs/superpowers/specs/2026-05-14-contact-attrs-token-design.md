# 컨택 attrs 토큰 — 설문 빌더 확장 디자인

**작성일**: 2026-05-14
**상태**: Draft → Review
**선행 작업**: slice 3 컨택리스트 (inviteToken, contact_targets.attrs, contactColumns 스킴), 메일 템플릿 변수 시스템

## 한 줄 요약

메일 빌더의 변수 토큰 시스템(`{{key}}` + `PopoverVariableMenu` + `getVariableCatalog`)을 **설문 빌더로 확장**한다. 응답 페이지가 invite token으로 attrs를 로드해 notice/description/table text 셀의 `{{key}}`를 치환하고, 단답형·input 셀은 신규 `defaultValueTemplate` 필드로 readonly prefill 처리한다. 익명 접근은 설문 단위 `requireInviteToken` 토글로 차단할 수 있다.

## 배경 / 동기

slice 3에서 컨택리스트 업로드 → contact_targets.attrs(Record<string,string>) → inviteToken 발번 → 메일 캠페인까지 동선이 완성됐다. 메일 본문은 이미 `{{전시회명}}` 같은 토큰을 컨택 attrs로 치환해 발송한다.

그러나 **응답자가 받는 설문지 본문은 정적**이다. "2026년 해외전시회 지원사업 성과평가 조사" 같은 운영 시나리오에서 응답자별 전시회명·개최일자·수행기관을 미리 채워둔 설문이 필요하지만, 현재는 모든 응답자에게 동일한 빈 칸이 보인다. 운영자가 응답 후 별도로 매칭해야 한다.

이 디자인은 메일 토큰 시스템과 **동일한 syntax·동일한 카탈로그·동일한 변수 메뉴**를 설문 빌더에서 재사용해, 컨택별로 prefill된 설문이 자동으로 발송되도록 한다.

## 결정 요약 (이미 합의된 항목)

| 항목 | 결정 |
|---|---|
| 토큰 syntax | `{{attrs_key}}` (메일과 100% 동일) |
| 적용 범위 | (1) `notice.noticeContent` (2) `questions.description` (3) `questions.title` (2026-05-26 확장) (4) `TableCell.content` (text 셀) (5) `TableCell.defaultValueTemplate` (input 셀, 신규) (6) `questions.defaultValueTemplate` (text 단답형, 신규) |
| 적용 제외 | radio/checkbox/select 옵션, 다단계 select, 분기 규칙, 검증 규칙 |
| 단답형/input 셀 prefill | **readonly disabled** 입력으로 표시. 응답자 수정 불가. 응답값에 그대로 저장 |
| 익명 접근(`?invite=` 없음) | 설문 단위 `requireInviteToken` 토글. true → 차단 페이지, false → 빈 문자열 치환 후 진행 (메일과 동일) |
| 변수 키 소스 | `surveys.contactColumns.columns` 중 `source.startsWith('attrs.')` 키. 폴백: 첫 컨택의 attrs Object.keys |
| 미해결 키 처리 | 빈 문자열로 치환 (메일 mode='send'와 동일) |
| 빌더 검증 | 토큰 매칭 실패 시 **경고 배지** (저장/발행 차단 X) |
| 응답값 보안 | 단답형 prefill 응답값은 서버에서 contact_targets.attrs 해당 키 값과 재검증 |

## 데이터 모델

세 곳의 스키마 변경. 모두 nullable·default 호환이라 기존 설문은 영향 없음.

### 1. `surveys` 테이블 — 익명 접근 차단 토글

```ts
requireInviteToken: boolean('require_invite_token').default(false).notNull(),
```

- `true` 이고 `?invite=` 없는 접근 → 안내 페이지 차단
- 빌더의 설문 설정 패널에 토글 추가

### 2. `questions` 테이블 — 단답형 prefill

```ts
defaultValueTemplate: text('default_value_template'),
```

- 빈 문자열 또는 `{{전시회명}}` 같이 토큰 포함 가능한 템플릿
- 응답 시점에 attrs로 치환되어 input의 value로 들어가고 disabled 처리
- text 단답형 외 다른 질문 타입은 무시 (radio/checkbox 등은 적용 범위 밖)

### 3. `TableCell` (JSONB 안의 옵셔널 필드)

```ts
// schema-types.ts TableCell 인터페이스에 신규 필드
defaultValueTemplate?: string;  // type='input' 셀 전용
```

- 의미는 위와 동일. table 안의 input 셀 케이스
- text 셀(`content`)은 본디 문자열이라 토큰 그대로 박으면 됨 — 신규 필드 불필요

### 마이그레이션 (drizzle 0018 가정)

```sql
ALTER TABLE surveys ADD COLUMN require_invite_token boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN default_value_template text;
-- TableCell.defaultValueTemplate 은 JSONB 안의 옵셔널 필드 — 마이그레이션 불필요
```

### 컬럼명 의도

`defaultValueTemplate`는 단순 `defaultValue`가 아니라 "토큰 포함 템플릿"임을 명확히 한다. 분석/응답값 저장 시 *치환 후 결과*가 `questionResponses`에 저장되며, 템플릿 원문은 빌더 단에만 보존된다.

## 빌더 UX

### 토큰 삽입 포인트

| 위치 | 입력 컨트롤 | 변수 메뉴 부착 |
|---|---|---|
| `notice.noticeContent` | TipTap 에디터 | 툴바에 `PopoverVariableMenu` 버튼 |
| `questions.description` | textarea | 옆에 작은 `{{}}` 아이콘 버튼 |
| `questions.defaultValueTemplate` (text 단답형) | 단일 라인 input | 옆에 작은 `{{}}` 아이콘 버튼 |
| `TableCell.content` (text 셀) | TipTap (CellContentModal) | 툴바에 변수 버튼 |
| `TableCell.defaultValueTemplate` (input 셀) | 단일 라인 input | 옆에 작은 `{{}}` 아이콘 버튼 |

모든 곳에서 동일한 [`PopoverVariableMenu`](../../../src/components/operations/mail-template/popover-variable-menu.tsx) 재사용. 카탈로그도 [`getVariableCatalog`](../../../src/components/operations/mail-template/variable-catalog.ts) 재사용.

### 변수 카탈로그 시그니처 조정

```ts
// variable-catalog.ts 시그니처 확장 (옵션 인자, 기본 'mail'로 기존 호출 호환)
getVariableCatalog(surveyId, options?: { purpose?: 'mail' | 'survey' })
```

- `purpose='survey'`이면 system 그룹(`invite_link`)을 비워서 반환
- `purpose` 미지정 시 기본 `'mail'` — 기존 호출부([new/page.tsx:12](../../../src/app/admin/surveys/[id]/operations/mail/templates/new/page.tsx#L12), [edit/page.tsx:18](../../../src/app/admin/surveys/[id]/operations/mail/templates/[mid]/edit/page.tsx#L18)) 무영향
- 설문 본문에서 `{{invite_link}}`는 의미가 없음 (이미 응답 페이지 자기 자신이므로)
- React `cache()` 키가 두 인자로 늘어나므로 동일 surveyId+purpose 호출은 여전히 캐시됨

### 빌더 미리보기 (응답 페이지 미리보기)

- 현재 `isPreviewMode`/`isTestMode`에 한 가지 추가:
- 빌더 미리보기 시 `?invite=` 없으니 **샘플 컨택 선택 셀렉터** 노출 (메일 미리보기와 동일 패턴)
- 첫 컨택 자동 선택 + 드롭다운으로 변경 가능
- 컨택 0명 시 "샘플 attrs 없음" 안내 + 빈 문자열로 치환된 모습 표시

### 토큰 검증 표시

- 본문에 사용된 토큰 키를 [`extractVariableKeys`](../../../src/lib/mail/variable-extractor.ts)로 추출
- `surveys.contactColumns`의 attrs 키 set과 매칭
- 매칭 안 되는 키는 **경고 배지**로 빌더 사이드 패널에 표시 (hard error 아님)
  - 예: "이 설문에 사용된 토큰 중 컨택 컬럼에 없는 키 2개: `{{전시횟수}}`, `{{참가비}}` — 발송 시 빈 값으로 치환됩니다."
- 저장/발행은 가능 (사용자가 의도적으로 빈 값 처리할 수도)

### 설문 설정 패널 — 토글 추가

- "초대 링크 필수" 체크박스 (`requireInviteToken`)
- 도움말: "켜면 `?invite=` 토큰 없이는 응답할 수 없습니다. 컨택리스트로 발송한 응답만 받고 싶을 때 사용하세요."

## 응답 페이지 동작

### 진입 처리 (`/survey/[id]?invite=<token>`)

기존 slice 3 동선에 두 가지 추가:

```ts
// 의사코드
1. invite token 검증 → contact_targets row 조회 (attrs, inviteToken 매칭)
2. survey 로드 + requireInviteToken 검사
   - if (requireInviteToken && !contactTarget) → 차단 페이지 렌더
3. attrs Record를 응답 페이지 컨텍스트에 주입 (React Context)
4. 토큰 치환은 렌더 시점에 적용
```

### 치환 함수 (재사용·신규)

메일의 [`renderMailPreview`](../../../src/lib/mail/render-preview.ts)에서 attrs 치환 부분만 추출 → `lib/survey/substitute-tokens.ts` 신규 모듈로 분리:

```ts
substituteTokens(template: string, attrs: Record<string,string>): string
```

재사용 위치:
- `notice.noticeContent` 렌더 직전
- `questions.description` 렌더 직전
- `TableCell.content` (text 셀) 렌더 직전
- `defaultValueTemplate` 평가 시 (단답형/input 셀)

### 단답형 / input 셀 prefill 동작

```tsx
const prefilled = substituteTokens(question.defaultValueTemplate ?? '', attrs);
const isPrefilled = Boolean(question.defaultValueTemplate?.trim());

<input
  value={prefilled}
  disabled={isPrefilled}
  className={isPrefilled ? 'bg-muted cursor-not-allowed' : ''}
/>
```

- `defaultValueTemplate`가 비어있으면 일반 입력
- 있으면 readonly + 치환값 표시
- 응답 제출 시 prefilled 값이 `questionResponses[questionId]`에 그대로 저장 → 분석에서 일반 응답과 동일하게 노출

### 익명 접근 매트릭스

| 케이스 | requireInviteToken=false | requireInviteToken=true |
|---|---|---|
| invite 없음 | 진행, attrs={}, 토큰 빈 문자열 치환 | 차단 페이지 |
| invite 있으나 무효 | amber alert + 익명 폴백 (기존 slice 3 동작) + 토큰 빈 문자열 | 차단 페이지 |
| invite 유효 | 정상 진행 + attrs 주입 | 정상 진행 + attrs 주입 |

차단 페이지는 thankYouMessage와 별개의 새 컴포넌트 (`<InviteRequiredScreen>`).

### 응답 도중 새로고침 / 재진입

- attrs는 contact_targets에서 매번 fresh 로드 (스냅샷 아님)
- 운영자가 컨택 attrs를 수정한 후 응답자가 새로고침하면 **새 값으로 prefill**
- 단, 이미 제출된 응답값은 영향 없음 — `questionResponses` JSONB는 제출 시점 스냅샷
- 의도: prefill은 "현재 컨택 정보 반영", 제출된 응답값은 "그 시점 스냅샷"

### 보안 검증

- invite token은 UUID v4 (예측 불가 — 4.0e+38 공간)
- attrs 주입은 서버 사이드에서만 — 클라이언트는 이미 치환된 결과만 받음
- 단답형 prefill 응답값은 서버에서 **재검증**: 제출된 값이 contact_targets.attrs 의 해당 키 값과 일치하는지 확인 후 저장 (조작 차단)
- `defaultValueTemplate`가 설정된 질문에 한해 검증 (일반 응답값은 재검증 없음 — 기존 동작)

## 캠페인 발송 측 변경

### 메일 캠페인 발송 — 변경 없음

- [`renderForCampaignSend`](../../../src/lib/mail/render-for-send.ts)는 그대로
- 메일 본문의 `{{invite_link}}`가 컨택별 URL로 치환되고, 그 URL이 응답 페이지 진입점이 됨
- 응답 페이지가 알아서 attrs 치환 + prefill 처리하므로 **메일 발송 코드에는 손댈 곳 없음**

### 운영 콘솔 — 컨택 상세 페이지에 invite URL 복사 버튼

- 이미 slice 3에 컨택 상세 페이지 있음 ([contact-detail-form.tsx](../../../src/components/operations/contacts/contact-detail-form.tsx))
- "응답 링크 복사" 버튼 추가 — `${baseUrl}/survey/${surveyId}?invite=${inviteToken}`
- 이유: 메일 외 채널(문자/카톡 수동 발송)에서도 동일 prefill 활용 가능

### 변경되지 않는 것 (확인용)

- `contact_uploads` 엑셀 업로드 흐름 — 변경 없음
- `contact_targets.attrs` 데이터 모델 — 변경 없음 (이미 `Record<string,string>`)
- `survey_responses` 응답 저장 — 변경 없음 (prefill된 값도 일반 응답값과 동일하게 `questionResponses`에 저장)
- 분석 / SPSS Export — 변경 없음 (서버에서 응답값을 그대로 사용)

## 마이그레이션 / 배포 순서

1. drizzle 0018: `requireInviteToken`, `questions.defaultValueTemplate` 컬럼 추가 (default false / nullable)
2. 코드 배포: 새 필드 사용. 기존 설문은 `requireInviteToken=false`, `defaultValueTemplate=null`이라 동작 동일
3. 빌더에 토큰 메뉴 노출 — 사용자가 자발적으로 사용 시작
4. 롤백 가능: 컬럼 그대로 두고 코드만 되돌리면 동작 복구

## 알려진 한계 / 후속 트래킹

- **prefill 가능 입력 타입이 좁음**: text 단답형 + table input 셀만. radio/checkbox/select prefill은 본 디자인 범위 밖. 필요해지면 별도 디자인.
- **`questions.title` 토큰 적용 (2026-05-26 확장)**: 초기 설계는 description/notice 컨벤션 강화를 위해 제외했으나, 전시회명 등 핵심 메타데이터가 제목에 들어가는 운영 시나리오 요구로 확장. description과 동일하게 응답 페이지 3곳(모바일 h2 / 데스크탑 CardTitle / 그룹 라벨)에서 `substituteTokens(q.title, attrs)` 적용. 줄 수 감지(`useMultiLineDetection`)도 치환 후 텍스트 기준.
- **변경 추적 없음**: 운영자가 컨택 attrs 수정 시 누가/언제 prefill 값이 바뀌었는지 별도 audit 로그 없음. 필요 시 후속 작업.
- **다국어 토큰 키**: 한글 키(`{{전시회명}}`)도 정규식이 받아냄(`[^}]+`). 다만 영문/한글 혼용 시 빌더 자동완성 키 정렬 UX 추가 고려 가능.

## 재사용되는 기존 자산

| 자산 | 위치 | 재사용 방식 |
|---|---|---|
| 변수 카탈로그 | [variable-catalog.ts](../../../src/components/operations/mail-template/variable-catalog.ts) | `purpose` 인자 추가, 그대로 재사용 |
| 변수 메뉴 UI | [popover-variable-menu.tsx](../../../src/components/operations/mail-template/popover-variable-menu.tsx) | 그대로 재사용 |
| TipTap 토큰 데코레이션 | [mail-var-token-plugin.ts](../../../src/components/operations/mail-template/mail-var-token-plugin.ts) | 그대로 재사용 (notice/table TipTap 에디터에 부착) |
| 토큰 키 추출 | [variable-extractor.ts](../../../src/lib/mail/variable-extractor.ts) | 그대로 재사용 (빌더 검증) |
| invite token 동선 | slice 3 응답 페이지 | 그대로 — 추가 분기만 |
| 컨택 상세 폼 | [contact-detail-form.tsx](../../../src/components/operations/contacts/contact-detail-form.tsx) | "응답 링크 복사" 버튼 추가 |
