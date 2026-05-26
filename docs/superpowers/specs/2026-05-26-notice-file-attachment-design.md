# 공지사항 파일 첨부/다운로드 버튼 — 디자인

- **작성일**: 2026-05-26
- **브랜치**: `feat/notice-file-attachment` (신규)
- **대상 파일**:
  - `src/components/ui/rich-text-editor/*` (신규 노드 + 모달 + 컨텍스트 툴바)
  - `src/components/survey-builder/question-basic-tab.tsx` (notice 분기 prop 전달)
  - `src/components/survey-builder/notice-renderer.tsx` (응답 페이지 CSS)
  - `src/app/api/upload/notice-attachment/route.ts` (신규)
  - `src/app/api/upload/mail-attachment/route.ts` (상수 추출에 따른 리팩터링)
  - `src/lib/survey/notice-attachment-promote.ts` (신규)
  - `src/lib/upload/attachment-policy.ts` (신규 — 양쪽 라우트 공유 상수·검증)
  - `src/lib/sanitize.ts` (allowlist 확장)
  - `src/lib/mail/constants.ts` (기존 `MAX_ATTACHMENT_FILE_BYTES`, `TMP_ATTACHMENT_PREFIX` 유지 — mail 전용)
- **상태**: 디자인 검토 단계

## 배경

공지사항(`question.type === 'notice'`) 본문 안에서 협조 공문·안내문 같은 PDF/HWP/DOCX를 응답자가 다운로드받을 수 있어야 한다는 운영 요청. 현재 RichTextEditor 툴바에는 이미지·링크·테이블 삽입은 있지만 파일 첨부 진입점이 없다. 메일 시스템에는 이미 `/api/upload/mail-attachment` 라우트와 `tmp/mail-attachment/` → 영구 prefix promote 패턴이 운용되고 있어, 동일 패턴을 mirror 한다.

## 목표 / 비목표

**목표**
- notice 본문 안에 파일 첨부 버튼을 자유 위치에 inline으로 배치 가능
- 사용자 지정 라벨 (파일명과 분리, 기본값=파일명)
- 한 notice에 첨부 개수 무제한 (R2 정책에만 의존)
- 메일 첨부와 동일한 파일 정책 (`ALLOWED_MIME` + `MAX_ATTACHMENT_FILE_BYTES`) 재사용
- R2 public URL 접근 (이미지·메일 첨부와 동일 보안 수준)
- 발행 시 `tmp/notice-attachment/` → `notice-attachment/` promote, 이전 영구 키 cleanup
- 응답 페이지에서 클릭 시 원본 파일명으로 다운로드

**비목표**
- notice 외 다른 질문 타입(`description`, 일반 RichText)에서의 파일 첨부 — 메일은 별도 첨부 시스템 유지
- presigned URL / 토큰 기반 접근 제어
- 첨부 파일에 대한 미리보기 (in-browser PDF viewer 등)
- 첨부 파일 통계/조회수 트래킹
- 24h 미발행 상태에서 R2 lifecycle로 `tmp/` 키가 사라진 후 빌더 자동 복구

## 사용자 시나리오

운영자가 "ESG 평가 협조 공문" 안내 공지사항을 만든다.
1. 빌더 `질문 추가` → `공지사항` 타입 선택
2. 공지사항 편집기에 본문 작성: "본 평가 관련 협조 공문은 아래에서 다운로드 받으시기 바랍니다."
3. 툴바 `Paperclip` 클릭 → 업로드 모달 → `2025-공문-협조요청-final.pdf` 드래그 → 라벨 입력 "협조 공문" → 업로드
4. 본문 안에 빨간 PDF 아이콘 + "협조 공문" 라벨의 inline 노드 등장
5. (선택) 노드 클릭 → 컨텍스트 툴바에서 라벨 재편집 또는 파일 교체·삭제
6. 동일 notice에 두 번째 첨부 "체크리스트.xlsx" 추가 → 본문 어디든 배치
7. 미리보기에서 응답자가 보게 될 화면 확인
8. 설문 발행 → `tmp/notice-attachment/` 키 두 개가 영구 prefix로 promote
9. 응답자가 `/survey/<slug>` 접근 → 두 첨부 버튼 클릭 → 원본 파일명으로 다운로드

## 아키텍처

```
[빌더 (admin/surveys/[id]/edit)]
  question-basic-tab.tsx (type='notice' 분기)
    └─ RichTextEditor (kind='survey')
         └─ Toolbar
              └─ NEW: 파일첨부 버튼 (Paperclip 아이콘)
                   └─ NEW: FileAttachmentUploadModal
                          └─ POST /api/upload/notice-attachment   (NEW route, mail-attachment route mirror)
                                 └─ R2 PUT: tmp/notice-attachment/<uuid>.<ext>
              └─ NEW: FileAttachmentContextToolbar (라벨 편집·교체·삭제)
         └─ NEW Extension: FileAttachment (TipTap inline atom node)

[Publish flow]
  survey-image-promote.ts (기존)
    └─ NEW: notice-attachment-promote.ts (mirror)
         └─ tmp/notice-attachment/  →  notice-attachment/
         └─ noticeContent HTML의 data-key + href 갱신
         └─ 이전 published 영구 키 중 사라진 것 cleanup

[응답 페이지 (survey/[id])]
  NoticeRenderer
    └─ sanitizeRichHtml 통과 → <a data-file-attachment download> 그대로 렌더
    └─ CSS .notice-file-attachment 스타일 (클립 아이콘 + 박스)

[R2 Lifecycle Rule]
  tmp/notice-attachment/*  → 24h 자동 삭제 (안전망, mail-attachment와 동일)
```

### 핵심 결정

1. **TipTap inline atom 노드 `fileAttachment`** — 일반 `<a>` 와 구분되어야 컨텍스트 툴바 트리거 가능. `atom: true, selectable: true` 로 통째 한 단위.
2. **별도 R2 prefix** — `notice-attachment/` 와 `tmp/notice-attachment/`. mail-attachment 키 공간과 분리하여 lifecycle·통계·orchestrator 책임이 섞이지 않게 함.
3. **별도 업로드 라우트** — `/api/upload/notice-attachment`. mail-attachment route 복제 (모든 가드 mirror). `feedback_image_pipeline_pattern.md` 룰 준수.
4. **publish promote 신규 모듈** — `notice-attachment-promote.ts`. `survey-image-promote.ts` 와 형제 파일.
5. **sanitize allowlist 확장** — `data-file-attachment`, `data-key`, `data-filename`, `data-size`, `data-mime`, `download` 속성 6종을 DOMPurify allowlist에 추가.

## 데이터 모델

### TipTap 노드 정의

```typescript
// src/components/ui/rich-text-editor/file-attachment-node.ts
const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key:      { default: null },  // R2 object key
      url:      { default: null },  // R2 public URL
      filename: { default: null },  // 원본 파일명
      label:    { default: '' },    // 사용자 지정 표시 라벨
      size:     { default: null },  // bytes
      mime:     { default: null },  // MIME type
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-file-attachment="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      {
        ...HTMLAttributes,
        'data-file-attachment': 'true',
        'data-key':      HTMLAttributes.key      ?? '',
        'data-filename': HTMLAttributes.filename ?? '',
        'data-size':     HTMLAttributes.size     ?? '',
        'data-mime':     HTMLAttributes.mime     ?? '',
        href:     HTMLAttributes.url ?? '#',
        download: HTMLAttributes.filename ?? '',
        target:   '_blank',
        rel:      'noopener noreferrer',
        class:    'notice-file-attachment',
      },
      HTMLAttributes.label || HTMLAttributes.filename || '첨부 파일',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentNodeView);
  },
});
```

### DB / Snapshot 영향

- `questions.noticeContent` (JSONB) — 기존 컬럼 그대로 사용, HTML 안에 `<a data-file-attachment>` 포함
- DB 스키마 변경 **없음**
- `snapshot_builder.ts` 변경 **없음** (HTML 통째 복사)
- `survey-save-actions.ts` 변경 **없음** (`noticeContent` 는 이미 explicit field set에 포함됨)

### sanitize 확장

```typescript
// src/lib/sanitize.ts
ADD_ATTR: [
  'data-file-attachment',
  'data-key',
  'data-filename',
  'data-size',
  'data-mime',
  'download',
],
// href의 javascript: 차단은 DOMPurify 기본 정책 유지
```

## UI / UX

### 빌더 — 툴바 진입점

`toolbar.tsx` 의 이미지/링크/테이블 아이콘 옆에 `Paperclip` 추가. `Toolbar` props에 `onPickFile?: () => void` 옵셔널 prop 추가 — undefined 면 버튼 미렌더. `question-basic-tab.tsx` 의 notice 분기에서만 prop 전달, mail/cell에서는 미전달.

### 빌더 — 업로드 모달

`image-upload-modal.tsx` 패턴 mirror. 차이점:
- accept: `application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.*,application/vnd.hancom.hwp*,application/x-hwp,application/hwp+zip,application/haansofthwp*,text/plain,text/csv,image/*`
- 업로드 **전에** 라벨 입력 받음 (빈 값 허용 → 파일명 fallback)
- 업로드 endpoint: `/api/upload/notice-attachment`
- `optimizeImage` 호출 안 함 (이미지 외 포맷 보존 필수)
- 업로드 성공 후 에디터 `insertContent` 로 `fileAttachment` 노드 삽입, 커서 노드 뒤로 이동

### 빌더 — NodeView (편집 화면 시각)

```
┌────────────────────────────────────┐
│   [PDF아이콘] 협조 공문             │
│              협조요청-final.pdf · 240KB │
└────────────────────────────────────┘
```

`lucide-react` 아이콘 + Tailwind 색상 클래스로 MIME별 분기:
- `application/pdf` → `FileText` + `text-red-600`
- HWP (`application/vnd.hancom.hwp*`, `application/x-hwp`, `application/hwp+zip`) → `FileText` + `text-purple-600`
- DOCX → `FileText` + `text-blue-600`
- XLSX → `FileSpreadsheet` + `text-green-600`
- PPTX → `FileText` + `text-orange-600`
- ZIP → `FileArchive` + `text-gray-600`
- 그 외 → `FileText` + `text-gray-500`

### 빌더 — 컨텍스트 툴바

`ImageContextToolbar` 패턴 mirror. 노드 active 시 메인 툴바 하단에 렌더:

```
[라벨: 협조 공문         ] [파일 교체] [삭제]
```

- 라벨: 인라인 input → `updateAttributes({ label })` chain
- 파일 교체: 동일 모달 재오픈 → 성공 시 새 attrs로 replace. 이전 attrs의 key가 `tmp/` 시작이면 즉시 DELETE 호출
- 삭제: `deleteSelection()` + 이전 key가 `tmp/` 시작이면 즉시 DELETE

### 응답 페이지 — NoticeRenderer

`sanitizeRichHtml` 통과 후 그대로 렌더. CSS만 추가:

```css
.notice-file-attachment {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  padding-left: 2.25rem;
  background: #f3f4f6 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'/></svg>") no-repeat 0.625rem center / 1rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
  color: #374151;
  text-decoration: none;
  font-size: 0.875rem;
}
```

응답 페이지·미리보기는 lucide `Paperclip` SVG를 CSS data URI로 박은 단일 회색 아이콘 + 라벨 + (선택적 파일명) 단순 표기. 빌더 NodeView 만 MIME 별 색 아이콘 분기.

→ 코드 텍스트 이모지 룰(`feedback_no_emoji_in_code.md`)을 엄격 적용 — CSS `content` 이모지 폐기, lucide SVG path를 inline data URI로 사용. sanitize 정책 변경 불필요(HTML 안에 SVG 박지 않음).

## 라이프사이클 / Cleanup

### 5층 cleanup (`feedback_image_pipeline_pattern.md` mirror)

| 시점 | 트리거 | 동작 |
|---|---|---|
| L1: 모달 닫기 | 사용자 X | XHR abort + (R2 박혔으면) DELETE 호출 |
| L2: 파일 교체 | 컨텍스트 툴바 replace | 이전 `tmp/` 키 즉시 DELETE |
| L3: 노드 삭제 | 컨텍스트 툴바 삭제 | `tmp/` 키였으면 즉시 DELETE |
| L4: Publish promote | 발행 액션 | `tmp/` → 영구 copy + href·data-key 치환 + `tmp/` 원본 DELETE. 이전 published 영구 키 중 새 HTML에 없는 것 DELETE |
| L5: R2 lifecycle | 자동 (24h) | `tmp/notice-attachment/` prefix 24h 미사용 자동 삭제 — 안전망 |

### Publish promote 알고리즘

```typescript
// src/lib/survey/notice-attachment-promote.ts
export async function promoteNoticeAttachments({
  surveyId,
  questions,       // 이전 published snapshot questions (orphan 검출용)
  draftQuestions,  // 새 publish 대상 questions
}: PromoteArgs): Promise<{
  updated: Question[];
  promotedKeys: string[];
  orphanedKeys: string[];
}>
```

1. `draftQuestions` 중 `type === 'notice'` 추림
2. 각 `noticeContent` HTML 을 cheerio/parse5로 파싱
3. `a[data-file-attachment="true"]` 중 `data-key` 가 `tmp/notice-attachment/` 시작인 것 수집
4. 각 키 → `CopyObjectCommand` (영구 prefix로) + HTML 안 `data-key`/`href` 치환 + `DeleteObjectCommand` (`tmp/` 원본)
5. 이전 published snapshot이 참조했던 영구 키 중 새 HTML에 없는 것 → DELETE
6. 갱신된 `questions` + promote/orphan 키 목록 반환

### 보안

`/api/upload/notice-attachment` 라우트는 `mail-attachment/route.ts` 의 모든 가드 mirror:
- `requireAuth()` — 관리자만
- `ALLOWED_MIME` + `EXT_TO_MIME` 화이트리스트 (`@/lib/mail/constants` 에서 import — DRY)
- `SAFE_FILENAME_RE` 검증, NUL/CR/LF + path traversal 차단
- `MIN_FILE_BYTES` / `MAX_ATTACHMENT_FILE_BYTES` 체크
- `HeadObjectCommand` 로 strong read-after-write 검증
- DELETE는 `tmp/notice-attachment/` prefix만 허용
- Sentry 태그: `operation: 'notice_attachment_upload' | 'notice_attachment_delete'`

### 공유 상수 추출 리팩터링

현재 `ALLOWED_MIME` / `EXT_TO_MIME` / `SAFE_FILENAME_RE` 는 `mail-attachment/route.ts` 의 module-scope const라 export되어 있지 않다. 양쪽 라우트 공유를 위해 신규 모듈로 추출:

```typescript
// src/lib/upload/attachment-policy.ts (NEW)
export const ALLOWED_MIME = new Set<string>([...]);
export const EXT_TO_MIME: Record<string, string> = {...};
export const SAFE_FILENAME_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,200}$/;
export const MIN_FILE_BYTES = 1;
export function resolveAttachmentType(filename: string, mime: string): { mime: string } | null { ... }
export function validateFilename(name: string): string | null { ... }
export function getFileExt(filename: string): string { ... }
export function isAllowedMime(mime: string): boolean { ... }
```

`mail-attachment/route.ts` 와 `notice-attachment/route.ts` 양쪽 모두 이 모듈에서 import. 크기 상수만 `MAX_ATTACHMENT_FILE_BYTES` 는 기존 위치(`@/lib/mail/constants`) 유지 — 두 곳에서 동일 값 사용.

`TMP_ATTACHMENT_PREFIX` (현재 `tmp/mail-attachment/`) 는 mail 전용으로 유지. 신규 상수 `TMP_NOTICE_ATTACHMENT_PREFIX = 'tmp/notice-attachment/'`, `NOTICE_ATTACHMENT_PREFIX = 'notice-attachment/'` 는 `@/lib/upload/attachment-policy.ts` 에 함께 추가 (upload 책임 단위로 묶음).

### Error handling

| 케이스 | 동작 |
|---|---|
| 업로드 중 네트워크 끊김 | XHR error → 모달 내 에러 박스 + "다시 시도" 버튼 |
| 5xx | error.message 표시, Sentry capture |
| 모달 닫기 도중 업로드 진행 | XHR abort + R2 박혔으면 DELETE |
| Publish promote 실패 | 발행 전체 abort, 사용자 안내 토스트, `tmp/` 보존 (재발행 시 재시도) |
| 응답 페이지 깨진 link | 브라우저 기본 404 (R2). 영구 키는 lifecycle 만료 없음 |
| 24h 미발행 후 빌더 재진입 | `tmp/` 자동 삭제로 깨진 노드. publish 시 promote 에러로 안내 — 사용자가 재업로드 필요 |

## 테스트 전략

### 위치
- 단위: `tests/unit/notice-attachment-*.test.ts`
- 통합: `tests/integration/notice-attachment-*.test.ts`
- vitest는 `tests/` 디렉토리만 include (`feedback_vitest_tests_dir_only.md`)
- 빌드 검증: `pnpm tsc` + `pnpm vitest run` + `pnpm build` (lint 인프라 깨짐)

### 단위 테스트

**`notice-attachment-node.test.ts`** — TipTap schema
- `parseHTML` ↔ `renderHTML` round-trip lossless (6 attrs 보존)
- `label` 빈 값 → `filename` fallback 직렬화 검증
- 외부 HTML(`<a data-file-attachment="true" data-key data-filename ...>`) 파싱 성공

**`notice-attachment-sanitize.test.ts`** — DOMPurify
- `<a data-file-attachment data-key data-filename data-size data-mime download href target rel class>` 통과
- `href="javascript:..."` 차단
- `onclick` 등 이벤트 핸들러 차단

**`notice-attachment-promote.test.ts`** — 가장 critical (TDD 강 적용)
- `tmp/notice-attachment/` 키 → 영구 prefix 치환 + HTML 내 `data-key`·`href` 갱신
- 이미 영구 키는 no-op
- 한 noticeContent에 여러 첨부 → 모두 promote
- 이전 published 영구 키 중 새 HTML에 없는 것 → `orphanedKeys` 수집
- R2 copy 실패 시 throw, 부분 promote 후 재실행 idempotent (영구 키는 skip)
- R2 mock: `@aws-sdk/client-s3` `S3Client.send` stub

### 통합 테스트

**`notice-attachment-upload-route.test.ts`**
- 인증 없음 → 401
- 허용 안 된 MIME → 400
- `MAX_ATTACHMENT_FILE_BYTES` 초과 → 400
- 정상 업로드 → R2 PUT + HEAD 호출 검증, 응답 JSON 형태 (`key`, `filename`, `size`, `mime`)
- DELETE: `tmp/notice-attachment/` 외 prefix 차단
- DELETE: path traversal (`..`, `//`) 차단

**`publish-with-notice-attachment.test.ts`**
- `tmp/` 첨부 1개 → publish 후 snapshot 영구 키만 존재
- 두 번 publish (첨부 교체) → 이전 영구 키 cleanup 호출 확인
- promote 실패 시 publish 전체 abort, DB rollback

### 수동 검증

`pnpm dev` 후 브라우저:
1. notice 질문 추가 → 툴바 클립 클릭 → PDF 업로드 + 라벨 "협조 공문" → 노드 시각 확인
2. 노드 클릭 → 컨텍스트 툴바 라벨 변경 → 저장·재로드 후 유지 확인
3. 동일 notice에 2개 첨부 → 본문 사이사이 배치
4. 발행 → `/survey/<slug>` 접근 → 첨부 클릭 시 원본 파일명으로 다운로드
5. 미리보기 모드 동일 동작 확인
6. R2 dashboard: 영구 prefix 객체 존재, `tmp/` 비어 있음

### TDD 우선순위

- **강**: `promoteNoticeAttachments` (복잡한 비즈니스 로직, 순수 함수에 가까움)
- **강**: sanitize 정책 (보안 회귀 차단)
- **중**: upload route POST/DELETE
- **약**: TipTap 노드·NodeView·모달 (수동 검증 비중 큼)

## 메모리 룰 준수 체크

- `feedback_image_pipeline_pattern.md` — tmp/ + R2 lifecycle 5층 cleanup ✓
- `feedback_no_emoji_in_code.md` — CSS data URI SVG로 통일, 텍스트/주석/HTML 이모지 0 ✓
- `feedback_survey_save_explicit_fields.md` — `noticeContent` 이미 explicit field set 포함, 추가 작업 불필요 ✓
- `feedback_vitest_tests_dir_only.md` — 테스트는 `tests/` 하위에만 ✓
- `feedback_lint_infra_broken.md` — lint 패스 검증 안 함, tsc + vitest + build로 대체 ✓
- `feedback_no_worktree.md` — feat 브랜치만 사용, worktree 금지 ✓
- `feedback_git_commit_korean.md` — 커밋 메시지 한국어 `feat: OOO 추가` 형식 ✓
- `project_security_batch_plan_a_done.md` — 인증 게이트 + path traversal + MIME 화이트리스트 ✓
- `project_response_page_snapshot_based.md` — promote 단계에서 snapshot에 영구 URL 박힘 ✓

## 후속 보류

- MIME 별 색 아이콘으로 빌더·응답 시각 통일 (현재는 빌더만 색 아이콘, 응답은 회색 클립)
- 첨부 파일 다운로드 통계 (조회수, 마지막 다운로드 시각)
- 만료/접근 제어 (presigned URL, invite token 기반)
- notice 외 질문 description/일반 RichTextEditor에서의 파일 첨부
- 한컴 hwp/hwpx 응답 페이지 다운로드 직후 OS별 동작 검증 (Windows 한글 vs macOS Preview)
