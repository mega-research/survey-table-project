# 메일 템플릿 슬라이스 — Design Spec

작성일: 2026-05-08
스코프: 운영 콘솔 ▸ 컨택 ▸ 메일 템플릿 (CRUD + TipTap 에디터 + 1명 테스트 발송)
다음 슬라이스: 단체발송·QR·이력은 별도 spec — `project_mail_next_slice_followups` 메모리 참조

---

## 1. 목표 / 비목표

### 목표
- 설문별로 메일 템플릿을 만들고 저장한다.
- TipTap 기반 에디터에서 텍스트 서식(B/I/U/폰트사이즈), 표(행·열·병합·분할·셀배경·너비 균등), 이미지 인라인, 변수 토큰 삽입을 지원한다.
- 첨부파일(15MB 이내) 을 R2 presigned 방식으로 업로드하고, 발송 시 본문 하단에 다운로드 박스로 자동 삽입한다.
- 미리보기 다이얼로그에서 컨택 1행을 골라 변수 치환된 메일을 메일 본문 폭 그대로 확인한다.
- 개발자 본인 등 1명 메일주소로 Resend + react-email 통한 테스트 발송이 동작한다.
- 본문에 `{{invite_link}}` 토큰을 넣으면 컨택별 inviteToken 으로 빌드된 응답 페이지 deep link 로 자동 치환된다.

### 비목표 (다음 슬라이스로 미룸)
- 단체발송 / 회차(캠페인) 관리 / 발송 이력 (mail_recipients 모델)
- `{{invite_qr}}` QR 이미지 동적 생성
- 수신거부(unsubscription) 링크
- 자동저장 (수동저장만)
- 글로벌 템플릿 라이브러리 (설문별만)
- 큰 첨부 → R2 링크 강제 변환 정책
- 첨부 만료/orphan cleanup cron

---

## 2. 결정 요약 (브레인스토밍 8문항)

| # | 결정 |
|---|---|
| Q1 보관 단위 | **A — 설문별** (`mail_templates.survey_id NOT NULL`) |
| Q2 발송 흐름 진입점 | 이번 슬라이스 = 템플릿 페이지 + 1명 테스트발송. 단체발송 페이지는 다음 슬라이스 |
| Q3 변수 토큰 형식 | **C — 하이브리드**: 저장은 `{{변수명}}` 텍스트, 편집 시 ProseMirror Decoration 으로 시각화 |
| Q4 테스트 발송 변수값 | **A — 컨택 1행 picker** 로 attrs 자동 채움 |
| Q5 첨부 파일 처리 | **B — R2 다운로드 링크** 본문 하단 자동 삽입 (받는 메일 본문 가벼움) |
| Q6 저장 정책 | **A — 수동저장** (명시적 [저장] 버튼) |
| Q7 시스템 변수 스코프 | **A — 텍스트 변수 + `{{invite_link}}`** 까지. `{{invite_qr}}` 는 다음 슬라이스 |
| Q8 에디터 레이아웃 | **A — 단일 컬럼** + 툴바 "+ 변수 ▾" Popover (cmdk 검색 + 스크롤) |
| Q9 reply_to / from | 템플릿별 `from_local`·`from_name`·`reply_to` 컬럼. env default 없음. `RESEND_FROM_DOMAIN` env 1개만 추가 |

---

## 3. 라우트 / 헤더 네비

### 신규 라우트
```
/admin/surveys/[id]/operations/mail-templates              # 목록
/admin/surveys/[id]/operations/mail-templates/new          # 생성
/admin/surveys/[id]/operations/mail-templates/[mid]/edit   # 편집
```
운영 콘솔 layout 그대로 활용 (헤더 + 탭 strip 자동 적용).

### 헤더 네비 변경
[operations-tab-strip.tsx](src/components/operations/operations-tab-strip.tsx) "컨택" 드롭다운에 1개 추가:
```
컨택 ▾
├─ 컨택리스트
├─ 리스트 업로드
├─ 컬럼 설정
├─ 결과코드 설정
└─ 메일 템플릿  ← 신규
```
(다음 슬라이스에 "메일·문자 발송" 추가될 자리 자연스럽게 확보됨)

---

## 4. 데이터 모델

### 마이그레이션 0018 — `0018_mail_templates.sql`
```sql
CREATE TABLE mail_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',

  from_local TEXT NOT NULL DEFAULT '',  -- @ 앞 계정 (예: "survey", "info"). 변수 토큰 X
  from_name TEXT NOT NULL DEFAULT '',   -- 발신 표시명. 변수 토큰 OK (예: "{{수행기관}}")
  reply_to TEXT,                         -- 답장 받을 메일. 자유 입력 (외부 도메인 OK). 변수 토큰 X

  attachments JSONB NOT NULL DEFAULT '[]',     -- MailAttachment[]
  variables_used JSONB NOT NULL DEFAULT '[]',  -- 발견된 토큰 키 캐시 (검증/UX용)

  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mail_templates_survey_id_idx
  ON mail_templates(survey_id) WHERE deleted_at IS NULL;
```

### Drizzle schema — `src/db/schema/mail.ts` (신규)
```ts
export const mailTemplates = pgTable('mail_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id').notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull().default(''),
  bodyHtml: text('body_html').notNull().default(''),
  fromLocal: text('from_local').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  replyTo: text('reply_to'),
  attachments: jsonb('attachments').notNull().default([]).$type<MailAttachment[]>(),
  variablesUsed: jsonb('variables_used').notNull().default([]).$type<string[]>(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mailTemplatesRelations = relations(mailTemplates, ({ one }) => ({
  survey: one(surveys, {
    fields: [mailTemplates.surveyId],
    references: [surveys.id],
  }),
}));

export type MailTemplate = typeof mailTemplates.$inferSelect;
export type NewMailTemplate = typeof mailTemplates.$inferInsert;
```

### `schema-types.ts` 추가
```ts
export interface MailAttachment {
  /** R2 object key — 예: mail/<surveyId>/<uuid>.pdf */
  key: string;
  filename: string;
  size: number;   // bytes
  mime: string;
}
```

### Zod schema (입력 검증)
```ts
const FROM_LOCAL_RE = /^[a-z0-9._-]+$/i;
const SAFE_NAME_RE = /^[^\s\\/:*?"<>|]{1,100}$/;  // 파일명 안전 문자

export const mailAttachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().regex(SAFE_NAME_RE),
  size: z.number().int().positive().max(15 * 1024 * 1024),  // 15MB
  mime: z.string().min(1),
});

export const mailTemplateInputSchema = z.object({
  name:        z.string().min(1).max(100),
  subject:     z.string().min(1).max(255),
  bodyHtml:    z.string().default(''),
  fromLocal:   z.string().min(1).max(64).regex(FROM_LOCAL_RE, '영문/숫자/점/하이픈/언더스코어만'),
  fromName:    z.string().min(1).max(100),
  replyTo:     z.string().email('유효한 이메일 주소를 입력해 주세요'),
  attachments: z.array(mailAttachmentSchema).default([]),
});
```

### 데이터 fetch — `src/data/mail-templates.ts` (신규)
- `getMailTemplatesBySurvey(surveyId)` — `deleted_at IS NULL`, `updated_at DESC`
- `getMailTemplate(surveyId, templateId)` — 단건 (다른 surveyId 의 템플릿 못 보게 가드)
- 모두 `React.cache` 래핑 (slice 4 진척률 패턴 동일)

### Server actions — `src/actions/mail-template-actions.ts` (신규)
- `createMailTemplateAction(surveyId, input)` → `revalidatePath` (목록)
- `updateMailTemplateAction(surveyId, id, patch)` → `revalidatePath` (목록 + 편집)
- `deleteMailTemplateAction(surveyId, id)` → soft delete (deletedAt 셋) → `revalidatePath`
- `sendTestMailAction(surveyId, templateId, contactId, overrideEmail?)` → 발송 결과 반환
- 권한: 모든 액션이 `requireSurveyOwner(surveyId)` 미들웨어 통과 (기존 패턴 재사용)

---

## 5. 변수 시스템

### 토큰 문법
- `{{변수명}}` — `body_html`, `subject`, `from_name` 모두 동일 문법
- 저장 모델: HTML 텍스트 그대로 (외부 메일 클라이언트 복붙 시 호환)
- 발송 치환: 정규식 `/\{\{([^}]+)\}\}/g`

### 편집 시 시각화 — ProseMirror Decoration 플러그인

`src/components/operations/mail-template/mail-var-token-plugin.ts` (신규):
```ts
const VAR_TOKEN_RE = /\{\{[^}]+\}\}/g;

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    let m: RegExpExecArray | null;
    VAR_TOKEN_RE.lastIndex = 0;
    while ((m = VAR_TOKEN_RE.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      decorations.push(
        Decoration.inline(from, to, { class: 'mail-var-token' })
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const mailVarTokenPlugin = new Plugin({
  key: new PluginKey('mail-var-token'),
  state: {
    init: (_, { doc }) => buildDecorations(doc),
    apply: (tr, old) => tr.docChanged ? buildDecorations(tr.doc) : old,
  },
  props: { decorations(state) { return this.getState(state); } },
});
```

### 토큰 하이라이트 CSS — `src/app/globals.css` 추가
```css
.mail-var-token {
  background: var(--color-amber-100);
  color: var(--color-amber-800);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.95em;
}
```

### 변수 카탈로그 — `src/components/operations/mail-template/variable-catalog.ts` (신규)
```ts
export interface VariableDef {
  key: string;
  label: string;
  category: 'attrs' | 'system';
  description?: string;
}

export async function getVariableCatalog(surveyId: string): Promise<VariableDef[]> {
  const system: VariableDef[] = [
    { key: 'invite_link', label: '응답 페이지 링크', category: 'system',
      description: '컨택별 inviteToken 으로 자동 빌드' },
  ];

  const survey = await getSurveyById(surveyId);
  const attrsKeys = survey.contactColumns?.columns
    ?.filter(c => c.source.startsWith('attrs.'))
    ?.map(c => ({ key: c.source.slice(6), label: c.label, category: 'attrs' as const })) ?? [];

  // 폴백: ContactColumnScheme 비어있으면 첫 컨택 1행 attrs keys
  if (attrsKeys.length === 0) {
    const sample = await getFirstContactTarget(surveyId);
    if (sample) {
      attrsKeys.push(...Object.keys(sample.attrs).map(k => ({
        key: k, label: k, category: 'attrs' as const,
      })));
    }
  }

  return [...attrsKeys, ...system];
}
```

### 발송 시 치환 — `src/lib/mail/render-template.ts` (신규)
```ts
import { headers } from 'next/headers';

export async function renderTemplateForContact(
  template: Pick<MailTemplate, 'subject' | 'bodyHtml' | 'fromName'>,
  contact: Pick<ContactTarget, 'attrs' | 'inviteToken'>,
  surveyId: string,
): Promise<{ subject: string; bodyHtml: string; fromName: string }> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const inviteLink = `${proto}://${host}/survey/${surveyId}?invite=${contact.inviteToken}`;

  const interpolate = (s: string) =>
    s.replace(/\{\{([^}]+)\}\}/g, (_m, raw) => {
      const key = raw.trim();
      if (key === 'invite_link') return inviteLink;
      return contact.attrs?.[key] ?? '';  // 미정의 = 빈 문자열
    });

  return {
    subject:  interpolate(template.subject),
    bodyHtml: interpolate(template.bodyHtml),
    fromName: interpolate(template.fromName),
  };
}
```

### 저장 시 검증
- 본문 + 제목 + from_name 에서 토큰 추출 → `variables_used` 컬럼에 캐시
- 카탈로그에 없는 토큰 → warning 표시 (block 안 함). 메시지: "이 변수는 발송 시 빈 값으로 대체됩니다."

---

## 6. 에디터 컴포넌트 — `MailTemplateEditor`

### 베이스
NoticeEditor (`src/components/survey-builder/notice-editor.tsx`) 의 `createEditorExtensions` + 툴바 분기를 참고하되, 메일 전용 별도 컴포넌트로 작성. 코드 공유는 copy-then-evolve (점진적 통합 X).

### 추가 TipTap extensions
```bash
pnpm add @tiptap/extension-underline @tiptap/extension-text-style tiptap-extension-font-size
```
- `Underline` — NoticeEditor 에 없음 (사용자 명시 요구)
- `TextStyle` + `tiptap-extension-font-size` — 폰트 사이즈 mark
- `mailVarTokenPlugin` — ProseMirror Plugin 직접 등록 (Mark/Node 가 아님)

### 테이블 편집 (NoticeEditor 그대로 재사용)
| 동작 | TipTap 명령 |
|---|---|
| 행 추가 | `addRowAfter` |
| 열 추가 | `addColumnAfter` |
| 행 삭제 | `deleteRow` |
| 열 삭제 | `deleteColumn` |
| 셀 병합 | `mergeCells` |
| 셀 분할 | `splitCell` |
| 표 삭제 | `deleteTable` |
| 셀 배경 | `updateAttributes('tableCell', { backgroundColor })` |
| 너비 균등 | NoticeEditor `equalizeColumnWidths` 함수 그대로 |
| 너비 드래그 | `Table.configure({ resizable: true })` |

### 툴바 구성 (좌→우)
```
[B] [I] [U] [폰트16▾]  |  [H1] [H2]  |  [• List] [1. List]
   |  [🖼 이미지] [🔗 링크] [⊞ 표] [+ 변수 ▾]  |  [↶] [↷]
```
표/이미지 활성 시 contextual toolbar 확장 (NoticeEditor 와 동일).

### Popover 변수 메뉴 — `popover-variable-menu.tsx` (신규)
- shadcn `Popover` + cmdk `Command`
- trigger: 툴바 `+ 변수 ▾` 버튼
- 내용:
  - 검색 input
  - 카테고리 헤더 ("attrs" / "시스템")
  - 항목 리스트 `max-h-[280px] overflow-y-auto`
- 항목 클릭: `editor.chain().focus().insertContent('{{' + key + '}}').run()` → popover close
- 키보드: ↑↓ 이동, Enter 선택 (cmdk 내장)
- 빈 카탈로그 안내: "이 설문에 컨택 attrs 가 등록되지 않았습니다. 컨택리스트 → 리스트 업로드부터."

### 파일 위치
```
src/components/operations/mail-template/
├── mail-template-editor.tsx       # 메인 에디터 컴포넌트
├── mail-var-token-plugin.ts       # ProseMirror Decoration
├── popover-variable-menu.tsx      # cmdk 변수 메뉴
├── variable-catalog.ts            # getVariableCatalog
├── editor-toolbar.tsx             # 메일 전용 툴바
├── attachment-uploader.tsx        # 첨부 박스 + 업로더
├── use-r2-upload.ts               # R2 presigned 업로드 훅
├── mail-preview-dialog.tsx        # 미리보기 다이얼로그
├── test-send-dialog.tsx           # 테스트 발송 다이얼로그
├── email-shell.tsx                # react-email shell
└── meta-fields.tsx                # 이름/제목/from/reply_to/첨부 메타 폼
```

### 페이지 레이아웃 (`/edit` 페이지)
```
운영 콘솔 헤더 (공통)
탭 스트립 (공통, 컨택 활성)
─────────────────────────────────────
[메타 영역]
  템플릿 이름   [.....................]
  메일 제목     [.....................]   변수 OK
  보낸이 표시명  [.....................]   변수 OK (예: {{수행기관}})
  보낸이 계정   [survey.....]@send.megaresearch.co.kr
  답장 받을 메일 [info@kotra.or.kr.....]
  첨부          📎 협조공문.pdf (1.2MB) ✕   ➕ 파일 추가
─────────────────────────────────────
[툴바]
─────────────────────────────────────
[본문 — TipTap EditorContent]
  안녕하세요, {{수행기관}} 담당자님.
  ...
─────────────────────────────────────
[하단 액션바]
                  [미리보기] [테스트 발송] [저장]
```

---

## 7. R2 Presigned 업로드

### API 라우트 — `POST /api/upload/presign` (신규 route handler)

**Input** (zod):
```ts
z.object({
  surveyId: z.string().uuid(),
  kind: z.enum(['image', 'attachment']),
  filename: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  size: z.number().int().positive(),
})
```

**서버 처리**:
1. `requireSurveyOwner(surveyId)` 권한 검증
2. kind 별 검증:
   - `image`: mime ∈ {jpeg, png, gif, webp, svg+xml, bmp}, size ≤ 10MB
   - `attachment`: 모든 mime, size ≤ 15MB. 단 blacklist 차단:
     `application/x-msdownload`, `application/x-msdos-program`, `application/x-sh`, `application/x-bat`, `application/x-executable`
3. key 생성: `mail/<surveyId>/<kind>/<nanoid()>-<sanitize(filename)>`
4. `@aws-sdk/s3-request-presigner.getSignedUrl(PutObjectCommand)` → 5분 유효 PUT URL
5. 응답: `{ uploadUrl, key, publicUrl }`
   - `publicUrl = ${env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`

### 클라이언트 훅 — `useR2Upload(surveyId)` (신규)
```ts
async function upload(file: File, kind: 'image' | 'attachment'): Promise<{ key: string; publicUrl: string }> {
  // 1. /api/upload/presign 호출 → uploadUrl, key, publicUrl
  // 2. XHR PUT with progress → R2 직접 업로드 (서버 우회)
  // 3. publicUrl 반환
}
```
- XHR progress callback (NoticeEditor 패턴 — `xhr.upload.addEventListener('progress', ...)`)
- AbortController 지원 (취소 가능)

### 이미지 통합 (TipTap)
- 툴바 [🖼] → 파일 picker → `upload(file, 'image')` → `editor.chain().focus().setImage({ src: publicUrl }).run()`
- 진행률 패널: NoticeEditor 의 `showImageUpload` 패턴 재사용
- 메일 호환성 메모: `<img src="https://r2-public/...">` 외부 링크. Gmail/Naver 가 외부 이미지 차단 시 사용자가 "이미지 표시" 한 번 누름 (표준 동작). CID inline embedding 은 다음 슬라이스.

### 첨부 통합 — `attachment-uploader.tsx`
- 메타 영역 "첨부" 박스 → 파일 picker → `upload(file, 'attachment')` → `attachments[]` 에 `{ key, filename, size, mime }` push
- 진행률 표시 (XHR)
- 박스 표시: `📎 협조공문.pdf (1.2MB) ✕` (삭제 버튼)
- 본문에 자동 삽입 X — react-email shell 이 발송 시 자동 렌더 (미리보기/실제 발송 동일 모양)
- 삭제 시 R2 객체 삭제 X (orphan 처리는 다음 슬라이스 cron)

---

## 8. 미리보기 다이얼로그 — `MailPreviewDialog`

shadcn `Dialog`, **`max-w-[960px]`** (Gmail/Naver PC 본문 영역 폭).

```
┌─ Dialog (max-w-[960px]) ──────────────────────────┐
│ 미리보기                                      [✕]  │
│ 컨택으로 미리보기 [홍길동 / KOTRA ▾]                │
│ ─────────────────────────────────────────────────  │
│   ┌─ Container (max-w-[720px]) ──────────────┐    │
│   │ 보낸이: 한국전시산업진흥회 <survey@send..> │    │
│   │ 답장:   info@kotra.or.kr                  │    │
│   │ 제목:   [KOTRA] 해외전시회 ... 김철수 귀하  │    │
│   │ ─────────────────────────────────────     │    │
│   │ [본문 — 치환된 HTML, 이미지·표 살아있음]    │    │
│   │ ─────────────────────────────────────     │    │
│   │ 📎 협조공문.pdf (1.2MB)                    │    │
│   │ 📎 조사표.docx (340KB)                     │    │
│   └────────────────────────────────────────────┘    │
│                                                    │
│                                          [닫기]    │
└────────────────────────────────────────────────────┘
```
- 컨택 picker 미선택 → 토큰 그대로 (`{{수행기관}}`) 표시
- picker 선택 → `renderTemplateForContact()` 호출, 치환된 결과 렌더
- 본문 영역: `dangerouslySetInnerHTML` (sanitized, 720px container 안)
- 첨부 박스: 메타필드 `attachments` 그대로 매핑 — react-email shell 과 동일 마크업
- 720px container = react-email Container max-w 와 동일 (다음 슬라이스 단체발송 시 미리보기 ≡ 실제 발송)

---

## 9. 테스트 발송

### Server action — `sendTestMailAction`
```ts
'use server';
export async function sendTestMailAction(input: {
  surveyId: string;
  templateId: string;
  contactId: string;
  overrideEmail?: string;
}) {
  await requireSurveyOwner(input.surveyId);

  const template = await getMailTemplate(input.surveyId, input.templateId);
  if (!template) throw new Error('템플릿을 찾을 수 없습니다');
  if (!template.fromLocal) throw new Error('보낸이 계정이 설정되지 않았습니다');
  if (!template.fromName)  throw new Error('보낸이 표시명이 설정되지 않았습니다');
  if (!template.replyTo)   throw new Error('답장 받을 메일이 설정되지 않았습니다');

  const contact = await getContactTarget(input.surveyId, input.contactId);
  if (!contact) throw new Error('컨택을 찾을 수 없습니다');

  const to = input.overrideEmail ?? contact.email;
  if (!to) throw new Error('받는 메일 주소가 없습니다');

  // 변수 치환 (subject, bodyHtml, fromName 모두)
  const rendered = await renderTemplateForContact(template, contact, input.surveyId);

  // react-email render
  const html = await render(
    <EmailShell
      subject={rendered.subject}
      bodyHtml={rendered.bodyHtml}
      attachments={template.attachments}
    />
  );

  // Resend 발송
  const fromAddr = `${rendered.fromName} <${template.fromLocal}@${process.env.RESEND_FROM_DOMAIN}>`;
  const result = await resend.emails.send({
    from: fromAddr,
    reply_to: template.replyTo!,
    to,
    subject: rendered.subject,
    html,
  });

  if (result.error) {
    throw new Error(`Resend 오류: ${result.error.message}`);
  }
  return { success: true, messageId: result.data?.id };
}
```
이번 슬라이스: 발송 로그 DB 저장 X (다음 슬라이스 `mail_recipients` 도입 시 통합). Sentry 로깅만.

### react-email shell — `email-shell.tsx`
```tsx
import { Html, Head, Body, Container, Section, Hr, Link, Text } from '@react-email/components';

interface Props {
  subject: string;
  bodyHtml: string;
  attachments: MailAttachment[];
}

export function EmailShell({ subject, bodyHtml, attachments }: Props) {
  const r2Public = process.env.CLOUDFLARE_R2_PUBLIC_URL!;
  return (
    <Html lang="ko">
      <Head><title>{subject}</title></Head>
      <Body style={{
        backgroundColor: '#f5f5f7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "WantedSans Variable", sans-serif',
        margin: 0, padding: '24px 0',
      }}>
        <Container style={{
          maxWidth: '720px', margin: '0 auto',
          backgroundColor: '#ffffff', borderRadius: '8px',
        }}>
          <Section
            style={{ padding: '32px 32px 16px' }}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
          {attachments.length > 0 && (
            <>
              <Hr style={{ borderColor: '#e5e5ea', margin: '0 32px' }} />
              <Section style={{ padding: '16px 32px' }}>
                <Text style={{ fontSize: '12px', color: '#6e6e73', margin: '0 0 8px' }}>
                  첨부파일
                </Text>
                {attachments.map(a => (
                  <Link key={a.key}
                    href={`${r2Public}/${a.key}`}
                    style={{
                      display: 'block', padding: '8px 12px',
                      border: '1px solid #e5e5ea', borderRadius: '6px',
                      marginBottom: '4px', color: '#007aff',
                      fontSize: '13px', textDecoration: 'none',
                    }}>
                    📎 {a.filename} ({prettySize(a.size)}) — 다운로드
                  </Link>
                ))}
              </Section>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}
```

### 테스트 발송 다이얼로그 — `TestSendDialog`

shadcn `Dialog`, `max-w-[480px]`.
```
┌─ Dialog (max-w-[480px]) ──────────────────────┐
│ 테스트 발송                              [✕]   │
│ ──────────────────────────────────────────── │
│ 컨택 선택 (변수 미리채움) *                     │
│ [홍길동 (KOTRA) ▾]   ← cmdk Combobox 검색      │
│                                              │
│ 받는 메일                                     │
│ [hong@example.com_______________]             │
│ ↑ 컨택 이메일 default, 직접 덮어쓰기 가능       │
│                                              │
│ ┌─ 변수 치환 미리보기 (read-only) ──────────┐ │
│ │ {{수행기관}}     → KOTRA                 │ │
│ │ {{참가기업명}}   → ㈜한국기업              │ │
│ │ {{invite_link}} → https://.../?invite=.. │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ ⚠️ 모든 변수가 정상 치환됐는지 확인하세요.     │
│                                              │
│              [취소]  [발송 →]                 │
└──────────────────────────────────────────────┘
```
- 컨택 picker: 검색 가능 cmdk Combobox. 기본 모든 컨택 노출 + 체크박스 "응답 안 한 컨택만 (`responded_at IS NULL`)" 옵트인 (기본 OFF) — 응답 끝낸 사람에게 같은 메일 또 보내는 사고 방지용 보조 필터
- 변수 치환 미리보기: `variables_used` 캐시 활용해서 본문/제목/from_name 에 등장한 토큰만 표시
- 발송 버튼: pending 상태 → 결과 toast (성공: messageId / 실패: 에러 메시지)

---

## 10. 환경변수

### 추가 (단 1개)
```
RESEND_FROM_DOMAIN=send.megaresearch.co.kr
```

### 기존 활용 (이미 .env 에 있음)
```
RESEND_API_KEY=re_...
CLOUDFLARE_R2_PUBLIC_URL=https://...
CLOUDFLARE_R2_BUCKET=...
```

### env 안 쓰는 것 (의도)
- `MAIL_FROM_NAME` ✗ — 템플릿 컬럼 (변수 토큰 가능)
- `MAIL_FROM_LOCAL` ✗ — 템플릿 컬럼
- `SITE_URL` ✗ — `headers()` 의 host/proto 활용

---

## 11. 패키지 추가

```bash
pnpm add resend @react-email/components @react-email/render
pnpm add @tiptap/extension-underline @tiptap/extension-text-style tiptap-extension-font-size
pnpm add @aws-sdk/s3-request-presigner   # 이미 있을 수 있음 — pnpm-lock 확인
```

---

## 12. Phase 분할 / PR 시퀀스 (권장)

| Phase | 범위 | 끝났을 때 검증 가능한 것 | 추정 LoC |
|---|---|---|---|
| **A — 구조** | 마이그레이션 0018, drizzle schema, `data/mail-templates.ts`, `actions/mail-template-actions.ts` (CRUD), 라우트 4개, 헤더 네비 추가, 메타 필드 폼. body 는 plain `<textarea>` 임시 (Phase B 에서 MailTemplateEditor 로 교체) | 이름·제목·from·reply_to·첨부메타 텍스트 입력 후 저장/목록/삭제 | ~350 |
| **B — 에디터** | TipTap 확장 install, `MailTemplateEditor` 본체, `mail-var-token-plugin`, `popover-variable-menu`, `variable-catalog`, 표 편집 핸들러 | 본문 편집 + 변수 토큰 삽입/하이라이트 + 표/서식 동작. 본문 저장까지. | ~550 |
| **C — R2 업로드** | `POST /api/upload/presign`, `useR2Upload`, 이미지 툴바 통합, `attachment-uploader` | 본문 이미지 인라인 + 첨부 업로드/삭제/메타 표시 | ~300 |
| **D — 발송** | resend + react-email install, `email-shell`, `render-template`, `MailPreviewDialog`, `TestSendDialog`, `sendTestMailAction` | 컨택 1행 picker + 1명 테스트 발송 + 미리보기 ✓ 슬라이스 완료 | ~400 |

**총 ~1600 LoC, 4 PRs.**

각 Phase 끝에서 dev 서버 동작 검증 가능 → 회귀 추적 쉬움. 각 PR commit 메시지는 한국어 컨벤션 (`feat: OOO 기능 추가`, 괄호 금지).

---

## 13. 보안 / 검증 / 제약

- **권한**: 모든 라우트/액션이 `requireSurveyOwner(surveyId)` 통과
- **첨부 mime blacklist**: 실행파일류 5개 (위 7장)
- **첨부 size**: 15MB hard cap (zod + presign API 둘 다 검증)
- **이미지 size**: 10MB hard cap
- **presigned URL TTL**: 5분
- **R2 bucket policy**: public bucket (Cloudflare 도메인) — 첨부 다운로드 링크가 무기한 유효
- **이메일 검증**: `replyTo` zod `.email()`, `fromLocal` regex
- **SQL injection**: Drizzle ORM parameterized query 사용
- **XSS**: 본문은 `dangerouslySetInnerHTML` 사용 — TipTap 출력은 신뢰 (사용자 자기 자신이 작성한 본문). 단, 외부 입력(컨택 attrs) 가 변수로 들어올 때 HTML escape 안 함 — attrs 값에 `<script>` 들어가면 발송 본문에 그대로. 운영자 본인이 엑셀 업로드 → 운영자 본인 메일 발송이라 신뢰 모델 충분. 다음 슬라이스에서 attrs 값 escape 정책 도입 검토.
- **Rate limit**: 이번 슬라이스 1명 발송이라 미적용. 다음 슬라이스에서 큐 + Resend 분당 한도 처리.

---

## 14. 비결정 / 후속 트래킹

이번 spec 에서 의도적으로 미해결 둔 항목:

1. **첨부 R2 객체 삭제 정책** — 템플릿 삭제 / 첨부 제거 시 R2 객체도 즉시 지울지, orphan 청소 cron 으로 미룰지. 다음 슬라이스에서 결정.
2. **attrs 값 HTML escape** — 위 13장 마지막 메모. 단체발송 시 더 큰 위험 → 다음 슬라이스에서 정책 도입.
3. **react-email rendering 캐시** — 동일 (template, contact) 의 HTML 생성을 매번 호출 vs Map 캐시. 1명 발송이라 무관, 단체발송 시 평가.
4. **font size 단위** — `tiptap-extension-font-size` 가 px 만 지원. 메일 클라 호환성상 `pt` 가 더 안전할 수 있음. 다음 슬라이스에서 호환성 테스트 후 결정.
5. **TipTap 확장 공유 모듈화** — NoticeEditor + MailTemplateEditor 가 90% 동일 확장 셋. 본 슬라이스는 copy-then-evolve. 두 번째 호출자가 생기면 (단체발송 본문 에디터?) 그때 공통화.

---

## 15. 마이그레이션 / 배포 노트

- 마이그레이션 0018 — 빈 테이블 추가, 기존 데이터 영향 0
- env `RESEND_FROM_DOMAIN` 추가 필요 (배포 환경 변수 갱신)
- pnpm install 5개 패키지 추가 (위 11장)
- 헤더 네비 항목 1개 추가 → 사용자 사파리 캐시 무관 (Next.js bust)

---

## 16. 다음 슬라이스 시작 시 불러올 메모리

- `project_mail_next_slice_followups` — QR/단체/이력/수신거부 8건 묶음 처리 항목
- `feedback_no_env_default_for_template_meta` — 운영자 메타데이터는 DB/attrs (env 금지)
- `feedback_brainstorming_design_guide` — mockup 그리기 전 globals.css 토큰 적용
- `feedback_git_commit_korean` — 커밋 메시지 한국어 형식, 괄호 금지
