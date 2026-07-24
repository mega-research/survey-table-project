# Task 5 Report — UI: 발송 다이얼로그 + 카드 정비

## 구현 내용

### Step 1 — `src/lib/operations/contacts.server.ts`
- `ContactDetailRow`에 `unsubscribedAt: Date | null` 필드 추가.
- `getContactDetailById`의 select에 `unsubscribedAt: contactTargets.unsubscribedAt` 추가. 반환부는 `...contact` spread라 자동으로 포함됨 (추가 수정 불필요).

### Step 2 — `src/components/operations/contacts/send-single-mail-dialog.tsx` (신규)
브리프 스켈레톤을 아래 3가지 실체 확인 후 정렬해서 작성:

1. **`renderMailPreview` 시그니처**: 브리프 스켈레톤과 실제 파일(`src/lib/mail/render-preview.ts`)이 완전히 일치함을 확인 — `input: { subject, bodyHtml, fromName, sample: PreviewSample | null, mode?: RenderMode }` → `{ subject, bodyHtml, fromName }`. 수정 없이 그대로 사용.
2. **`src/components/ui/dialog.tsx` 존재 여부**: 존재함 (Radix `Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`). 스켈레톤이 import한 그대로 사용 가능.
3. **`preview-dialog.tsx` 본문 렌더 방식**: `dangerouslySetInnerHTML` div가 아니라 **iframe + `sanitizeRichHtml` + `srcDoc`** 방식(`sandbox="allow-same-origin"`, `IFRAME_RESET_CSS`로 메일 클라이언트 CSS 격리 재현)이었음. 스켈레톤의 `<div dangerouslySetInnerHTML>`을 iframe 방식으로 교체 — sanitize 없이 렌더하면 관리자 뷰에 원본 HTML(스크립트 포함 가능)이 그대로 꽂히는 문제가 있어 `sanitizeRichHtml`을 반드시 거치도록 함.

추가로 스켈레톤 대비 개선한 부분:
- `sample`이 `GetMailPreviewSampleOutput`(nullable)이므로 컨택 정보를 확인할 수 없는 케이스를 amber 경고 박스로 명시 처리.
- fetch 상태를 `idle/loading/ready/error` 유니온으로 관리 (loading spinner, error 박스) — preview-dialog.tsx와 동일한 패턴.
- 다이얼로그 재오픈 시 이전 templateId/에러/fetchState를 리셋 (`onOpenChange`에서 close 시 초기화).
- `useEffect` 안에서 `queueMicrotask`로 loading 세팅 — React Compiler의 `set-state-in-effect` lint 경고 제거 (preview-dialog.tsx와 동일 관례).
- summary/details 토글 충돌: 버튼 `onClick`에 `stopPropagation()`만 사용 (`preventDefault` 없음) — Radix `DialogTrigger`가 같은 엘리먼트에서 open을 토글하는 것은 그대로 두고, 이벤트가 `<summary>` 조상으로 버블링되는 것만 차단. `preventDefault`를 쓰면 Radix `composeEventHandlers`의 `checkForDefaultPrevented` 때문에 자체 open 토글이 씹혀서 다이얼로그가 안 열리는 부작용이 있어 배제했다 (실제로 처음엔 preventDefault+수동 setOpen(true)로 짰다가, 브리프 원안이 stopPropagation만 쓴 이유를 재확인하고 단순화).

### Step 3 — `src/components/operations/contacts/contact-mail-history-card.tsx`
- `action?: ReactNode` prop 추가 (`import type { ReactNode } from 'react'`), summary 우측 배지 왼쪽에 배치.
- 회차 표기: `{r.kind === 'single' ? '단건' : `${r.runNumber}회차`} · {r.campaignTitle}`.

### Step 4 — 페이지/폼 prop 스레딩
- `page.tsx`: `getMailTemplatesBySurvey(surveyId)`를 `Promise.all`에 추가. `hasEmail`(piiDecrypted에 fieldType==='email'이고 plain이 non-empty인 항목 존재 여부) + `mailSendDisabledReason`(수신거부 우선 → 이메일 없음 → null) 계산 후 `mailTemplateOptions`로 매핑해 `<ContactDetailForm mailSend={{ templates, disabledReason }} />`로 전달.
- `contact-detail-form.tsx`: `mailSend?: { templates: MailTemplateOption[]; disabledReason: string | null }` prop 추가 — `new/page.tsx`가 이 prop 없이 `ContactDetailForm`을 호출하는 것을 확인했으므로 optional로 유지. `<ContactMailHistoryCard rows={mailHistory} action={mailSend ? <SendSingleMailDialog .../> : undefined} />`.

## 검증

```
pnpm exec tsc --noEmit   → 통과 (에러 0)
pnpm lint                → 100 warnings(전부 이번 변경과 무관한 기존 파일의 no-explicit-any), 에러 0
```
변경 파일 대상 개별 `eslint` 실행도 별도로 확인 — 최초 1개 warning(`set-state-in-effect`, useEffect 내 동기 setState)을 `queueMicrotask` 패턴으로 감싼 뒤 0 warning/0 error.

## Files changed

- `src/lib/operations/contacts.server.ts`
- `src/components/operations/contacts/send-single-mail-dialog.tsx` (신규)
- `src/components/operations/contacts/contact-mail-history-card.tsx`
- `src/components/operations/contacts/contact-detail-form.tsx`
- `src/app/admin/surveys/[id]/operations/contacts/[contactId]/page.tsx`

커밋: `7f4c6c3e` "feat: 컨택 상세 단건 메일 발송 다이얼로그 추가" (5 files changed, 359 insertions, 5 deletions).

## Self-review

- **prop 체인**: page(`mailSendDisabledReason`/`mailTemplateOptions`) → form(`mailSend` optional prop) → card(`action` slot) → dialog(`SendSingleMailDialog`) — grep으로 각 지점 재확인, 끊긴 곳 없음.
- **disabledReason 두 케이스**: `unsubscribedAt` 있으면 "수신거부된 대상입니다", 없고 `hasEmail=false`면 "이메일 정보가 없습니다" — 둘 다 `page.tsx` 삼항으로 명시 커버. 둘 다 아니면(null) 다이얼로그가 정상 버튼으로 렌더.
- **다이얼로그 열기 전 sample 미로드**: `useEffect`가 `open` 의존성이라 닫힌 상태에선 fetch 자체가 안 됨. Radix `DialogContent`는 `open=false`일 때 언마운트되므로 미로드 상태의 `sample`/`selected`/`preview` 파생값 접근으로 인한 크래시 없음 (전부 초기값이 `null`/빈 상태).
- **new 페이지 영향 없음**: `ContactDetailForm`이 `mailSend`를 옵션으로 받으므로 `new/page.tsx` (mailSend 미전달) 컴파일·동작 그대로 (action은 `undefined`가 되어 `ContactMailHistoryCard`도 배지만 렌더).

## Concerns

- `sendSingleCampaign` 서비스가 발송 실패 시 던지는 Error message가 실제로 한국어 사유(수신거부/이메일 없음 등)로 오는지는 Task 2 산출물을 신뢰하고 그대로 표시만 했음 — Task 6 통합 검증에서 실제 실패 케이스 문구를 한 번 실물로 확인하는 것을 권장.
- 미리보기 iframe은 `mode: 'preview'`로 렌더링(누락/빈 값 강조 span 포함)하며, 실제 발송 로직(`sendSingleCampaign` 내부의 `mode: 'send'` 렌더링으로 추정)과는 시각적으로만 다르고 다이얼로그의 발송 버튼은 렌더링된 HTML이 아니라 `mailTemplateId`만 서버로 보내므로 실제 발송 내용에는 영향 없음.

## 최종리뷰 fix

전체 브랜치 최종 코드 리뷰에서 나온 4건(Important 1 + Minor 3)을 모두 수정.

1. **부정 결과코드 pre-guard 누락 (Important)** — `mail-single-send.service.ts`: unsubscribedAt 체크 직후 `getResultCodeStatuses(surveyId)` + `buildNegativeCodeExists`로 해당 컨택 1건에 대해 부정 결과코드 존재 여부를 EXISTS 조건으로 선검증하는 select 추가. 있으면 `'연락금지 결과코드가 기록된 조사 대상입니다.'` 에러로 fail-closed. `mail-single-send.service.test.ts`: `@/lib/operations/result-code-statuses.server`를 vi.mock, 기존 4건 테스트의 selectResultQueue에 negative-check select 응답을 끼워넣고, 부정 코드 매치 케이스 테스트 1건 신규 추가(createCampaign 미호출 검증 포함).
2. **billing 화면 단건 회차 1000001 원문 노출 (Minor)** — `mail-billing.server.ts`: `CampaignCycleRow`에 `kind: MailCampaignKind` 추가, select/매핑 양쪽에 `mailCampaigns.kind` 반영. `cycle-summary-table.tsx`: 회차 셀을 `c.kind === 'single' ? '단건' : c.runNumber`로 분기(기존 `contact-mail-history-card.tsx`의 동일 분기 표기 관행과 통일). `cycle-summary-table.test.tsx`에 kind='single' 렌더 테스트 1건 추가, 기존 fixture에 `kind: 'bulk'` 보강.
3. **다이얼로그 canSend가 sample=null에서도 활성 (Minor)** — `send-single-mail-dialog.tsx`: `canSend`에 `sample != null` 조건 추가. fetch는 성공했지만 컨택의 수신자 정보를 확인할 수 없는(스코프 미스매치 등) amber 경고 상태에서 발송 버튼이 눌리는 경로 차단.
4. **stopPropagation 주석 부정확 (Minor)** — 같은 파일 발송 버튼 onClick 주석을 사실에 맞게 수정: `<summary>` 안에 중첩된 `<button>` 클릭은 스펙상 activation target이 button 자신으로 해석되어 summary의 접힘 토글 자체가 애초에 발동하지 않으므로, `stopPropagation()`은 그 토글을 막기 위한 것이 아니라 조상에 걸릴 수 있는 다른 커스텀 클릭 핸들러로 이벤트가 새는 것을 막는 방어용이라고 명시.

### 검증

```
pnpm exec vitest run src/features/mail tests/unit/operations/cycle-summary-table.test.tsx tests/integration/mail-billing-archive.test.ts
→ 9 files passed, 45 tests passed

pnpm exec tsc --noEmit
→ 통과 (에러 0)

pnpm exec eslint <6개 변경 파일>
→ 0 warning / 0 error
```

### Files changed (이번 fix 커밋)

- `src/features/mail/server/services/mail-single-send.service.ts`
- `src/features/mail/server/services/mail-single-send.service.test.ts`
- `src/lib/operations/mail-billing.server.ts`
- `src/components/operations/mail-cost/cycle-summary-table.tsx`
- `src/components/operations/contacts/send-single-mail-dialog.tsx`
- `tests/unit/operations/cycle-summary-table.test.tsx`
