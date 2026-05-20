# 메일 에디터 이미지 같은 줄 inline 배치 — 디자인

- **작성일**: 2026-05-19
- **브랜치**: `feat/mail-image-inline-paragraph` (신규)
- **대상 파일**: `src/components/ui/rich-text-editor/*`, `src/app/globals.css`, `src/lib/mail/template-wrapper.tsx`, `src/components/operations/mail-template/preview-dialog.tsx`
- **상태**: 디자인 검토 단계

## 배경

메일 템플릿 편집기에서 이미지 두 장을 같은 줄에 나란히 두는 게 불가능하다. 현재 정렬은 wrapper 인라인 스타일의 `float: left/right` 와 `margin: 0 auto` (center) 로 처리되고, paragraph 는 `display: block !important; clear: both !important` 로 강제되어 있다. TipTap `setImage` 가 보통 새 paragraph 를 만들기 때문에, 두 이미지가 서로 다른 `<p>` 에 들어가면 `clear: both` 가 줄바꿈을 강제해 옆에 못 온다.

운영자 요청: 좁은 폭(50% 등) 이미지 두 장을 같은 줄에 묶어 배치하고 싶음. 단 텍스트나 표가 이미지 옆에 흘러드는 부작용은 차단해야 함.

## 목표 / 비목표

**목표**
- 같은 paragraph 안에 이미지 여러 장을 inline 으로 배치 → 자연 흐름으로 옆에 나란히
- 이미지 정렬(좌/중/우) 을 paragraph `text-align` 단위로 통일 — 사이즈(%·px) 와 정렬은 독립적으로 동작
- 드래그 resize 기능 그대로 유지 (wrapper width 갱신 경로 변경 없음)
- 사이즈 토글(25/50/75/100%) 기능 그대로 유지
- "이미지+텍스트 같은 줄" 차단 — paragraph 안에 이미지와 텍스트가 섞이면 자동으로 분리
- 편집 시각과 미리보기 iframe / 발송 wrapper 의 시각 일관성 유지

**비목표**
- 기존 float 기반으로 저장된 메일 템플릿 자동 마이그레이션 (운영자가 재작성)
- "테이블+이미지" 또는 "테이블+텍스트" 한 줄 배치 — 표는 block + `clear: both` 로 이미 자연 차단
- 같은 줄 안에서 이미지마다 다른 정렬 (예: 첫 장 좌, 두 번째 우) — paragraph 단위 정렬 그룹 한 축만

## 사용자 시나리오

운영자가 메일 본문에 두 장의 안내 이미지(QR + 포스터)를 같은 줄에 나란히 두고 싶다.
1. 이미지 업로드 버튼으로 첫 이미지 삽입 → 50% 사이즈 토글 → 좌측 정렬 → 같은 줄에 50% 폭으로 표시
2. 첫 이미지 직후(같은 paragraph 안) 두 번째 이미지 삽입 → 50% 사이즈 → 같은 줄에 두 장이 50%+50% 로 나란히
3. 두 이미지 사이를 클릭하고 텍스트 입력 → 텍스트는 자동으로 다음 줄(새 paragraph) 로 떨어짐
4. 정렬 버튼 "가운데" 클릭 → 두 이미지가 묶음 단위로 가운데 정렬 (둘이 합해 100% 면 시각 차이 없음)
5. 첫 이미지 폭을 30% 로 줄이면 두 장이 30%+50% 가 되어 paragraph 우측에 빈 공간이 생김 — `text-align: right` 면 두 묶음이 우측에 붙음

단일 이미지 시나리오: 이미지 1장을 70% 가운데 → wrapper `width: 70%`, paragraph `text-align: center` → 부모 100% 안에서 70% inline-block 이 가운데 정렬.

자유 resize 시나리오: 드래그 핸들로 320px 까지 줄이고 우측 정렬 → wrapper `width: 320px`, paragraph `text-align: right` → 우측에 320px 이미지.

## §1: ProseMirror plugin — 이미지+텍스트 분리 가드

같은 paragraph 안에 이미지 노드(`imageResize`) 와 의미 있는 텍스트 노드가 공존하지 못하도록 강제하는 plugin.

```ts
// src/components/ui/rich-text-editor/image-text-split-plugin.ts
import { Plugin, PluginKey } from '@tiptap/pm/state';

const IMAGE_NODE = 'imageResize';

export const imageTextSplitPluginKey = new PluginKey('imageTextSplit');

export function imageTextSplitPlugin() {
  return new Plugin({
    key: imageTextSplitPluginKey,
    appendTransaction(_transactions, _oldState, newState) {
      let tr = newState.tr;
      let modified = false;

      newState.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph') return true;

        let hasImage = false;
        let hasText = false;
        node.forEach((child) => {
          if (child.type.name === IMAGE_NODE) hasImage = true;
          else if (child.isText && child.text && child.text.trim().length > 0) hasText = true;
        });

        if (hasImage && hasText) {
          // 이 paragraph 를 이미지/텍스트 두 paragraph 로 분리
          // 구현: 텍스트 노드를 별도 paragraph 로 추출
          // (상세 알고리즘은 plan 단계에서 ProseMirror Slice API 로 작성)
          modified = true;
        }
        return false;
      });

      return modified ? tr : null;
    },
  });
}
```

**알고리즘 선택지** (plan 단계에서 결정):
- A) **텍스트를 새 paragraph 로 분리**: 이미지 paragraph 끝에서 split 후 텍스트만 새 paragraph 로 이동
- B) **이미지를 새 paragraph 로 분리**: 텍스트 paragraph 에서 이미지를 떼어내 별도 paragraph 로
- 선택: A — 일반적으로 사용자가 이미지를 먼저 두고 텍스트를 입력하는 패턴이 많음

**extensions.ts 등록**: `createUnifiedExtensions` 전체에 plugin 추가 (mail/survey 모두). 설문 빌더의 notice 질문 에디터에서도 동일하게 이미지+텍스트 같은 paragraph 입력 시 자동 분리.

## §2: wrapper 인라인 스타일 단순화 + paragraph text-align 정렬

### 현재 → 변경

**현재 ([image-context-toolbar.tsx:23-29](../../src/components/ui/rich-text-editor/image-context-toolbar.tsx#L23-L29))**:
```ts
const ALIGN_BASE: Record<Align, string> = {
  left:  'display: inline-block; float: left;  vertical-align: top; box-sizing: border-box; padding-right: 4px;',
  right: 'display: inline-block; float: right; vertical-align: top; box-sizing: border-box; padding-left: 4px;',
  center:'display: block; margin: 0 auto;     vertical-align: top; box-sizing: border-box;',
};
```

**변경 후**:
```ts
// 정렬에 무관한 wrapper 공통 스타일. 정렬은 paragraph text-align 으로 옮김.
const WRAPPER_BASE = 'display: inline-block; vertical-align: top; box-sizing: border-box;';

function buildWrapperStyle(widthPct?: number): string {
  return widthPct ? `${WRAPPER_BASE} width: ${widthPct}%;` : WRAPPER_BASE;
}
```

### 정렬 적용 로직

**TipTap `@tiptap/extension-text-align` 패키지 사용으로 확정.**
- paragraph 에 `textAlign` attribute 추가, 렌더링 시 `<p style="text-align: ...">` 출력
- `editor.chain().focus().setTextAlign(target).run()` 으로 적용 — selection 의 부모 paragraph 에 자동 적용
- `editor.getAttributes('paragraph').textAlign` 으로 읽기
- 패키지가 설치되어 있지 않다면 plan 단계의 첫 task 로 `pnpm add @tiptap/extension-text-align` 추가
- `createUnifiedExtensions({ kind: 'mail' })` 에서만 등록 — types: `['paragraph']` 로 한정해 다른 block 영향 차단

`setAlign(target)` 동작 변경:
- 현재: 이미지 wrapper 의 `wrapperStyle` 에 float/margin 부분 교체
- 변경: 이미지 NodeSelection 상태에서 `setTextAlign(target)` 호출. wrapperStyle 은 손대지 않음 (단, 옛 데이터의 잔존 float/margin 제거를 위해 동시에 wrapperStyle 을 `WRAPPER_BASE + width` 로 정규화)

`s.align` 읽기:
- 현재: wrapper style 에서 float 패턴 매치
- 변경: 선택된 이미지가 속한 paragraph 의 `textAlign` attribute. `editor.state.doc.resolve(selectedImagePos).parent.attrs.textAlign` 으로 직접 조회. 값 없으면 `'left'` default.

### wrapper width 갱신 (사이즈 토글)

`setSize(pct)` 동작 변경 최소:
- 현재: wrapperStyle 에 align + width 합쳐서 박음
- 변경: wrapperStyle 은 `${WRAPPER_BASE} width: N%;` 만. 정렬과 분리됨.

### 드래그 resize 동작

`tiptap-extension-resize-image` 가 wrapper width 를 px 또는 % 로 갱신. wrapper 의 다른 스타일(`display`, `vertical-align`, `box-sizing`) 은 유지되어야 함. 패키지의 wrapper width 갱신 경로가 inline style merge 인지 replace 인지 확인 필요. replace 라면 width 만 갱신되도록 패치 또는 NodeView 커스터마이즈.

→ plan 단계에서 패키지 동작 검증 후 결정.

## §3: CSS 룰 정리

### globals.css

**제거 대상** (float 안 씀):
```css
/* line 591-598 - float 기반 룰 */
.ProseMirror div[style*="float: left"] { margin-right: 8px !important; }
.ProseMirror div[style*="float: right"] { margin-left: 8px !important; }
```

**추가**: 같은 paragraph 안 이미지 wrapper 사이 간격
```css
/* 메일 에디터 — 같은 paragraph 안 이미지 wrapper 사이 간격 */
.mail-editor-body p > div[style*="cursor: pointer"] + div[style*="cursor: pointer"] {
  margin-left: 8px;
}
```

**유지**: MAIL_BASE 의 `[&_p]:!block` 및 `[&_p]:clear-both`, 테이블 clear:both.

### rich-text-editor.tsx MAIL_BASE

TextAlign extension 이 paragraph 에 직접 `style="text-align: ..."` 을 박으므로 Tailwind 안전망 룰은 **불필요**. 다만 `MAIL_BASE` 의 기존 `[&_p]:!block` 룰이 `display: block`을 강제하므로 inline-block 자식들의 text-align 정렬에 영향 없음 (block 부모 + inline-block 자식에 text-align 작동).

### preview-dialog.tsx IFRAME_RESET_CSS

**중요**: 미리보기 iframe / 발송 HTML 에서는 `ImageResizeWithProxy.renderHTML` 이 wrapper div 를 제거하고 wrapperStyle 을 `<img>` inline style 로 직렬화한다 ([extensions.ts:95-106](../../src/components/ui/rich-text-editor/extensions.ts#L95-L106)). 따라서 CSS 셀렉터는 `img` 만 대상.

paragraph `text-align` 이 inline-block 이미지에 적용되도록 명시적 룰 + 옛 float 안전망:
```css
p { margin: 0 0 0.5em 0; clear: both; }
p img {
  display: inline-block !important;
  float: none !important;
  vertical-align: top;
  max-width: 100%;
}
p > img + img {
  margin-left: 8px;
}
```

### template-wrapper.tsx 발송용 `<style>`

동일 룰 반영 (clear: both + inline-block + float: none 안전망 + 인접 형제 margin). Gmail/Outlook 일부 클라이언트가 `<style>` 룰을 무시할 수 있으므로 — 새 데이터는 img inline style 에 float 이 없어 영향 0, 옛 데이터만 잠재적 시각 차이 (수용 가능).

## §4: 마이그레이션 정책

**자동 마이그레이션 안 함.** 기존에 저장된 메일 템플릿의 wrapperStyle 에 `float: left/right` 또는 `margin: 0 auto` 가 박혀 있으면 새 모델에서 시각이 다소 깨질 수 있다. 처리:
- 옛 wrapperStyle 의 float 은 그대로 두되, mail-editor-body 의 CSS 안전망으로 시각만 보정:
  ```css
  .mail-editor-body p > div[style*="cursor: pointer"] {
    float: none !important;
    display: inline-block !important;
  }
  ```
  iframe / template-wrapper 의 `<style>` 에도 동일 룰 반영. 결과: 옛 데이터는 정렬 정보(좌/중/우)는 잃지만 inline-block 자체는 깨지지 않음 — 좌측에 모임.
- 운영자가 메일 템플릿을 열어 정렬 버튼을 한 번 다시 누르면 paragraph textAlign 으로 옮겨가고, 동시에 setAlign 로직이 wrapperStyle 을 새 형태로 정규화 (§2 setAlign 항목 참조).
- 데이터 손실 위험 없음 — DB 의 HTML 원본은 그대로.

운영 안내:
- 기존 메일 템플릿을 가진 설문이 있으면 운영자에게 "메일 편집기에서 한 번 다시 저장 권장" 안내 (별도 release note)
- 메일 발송 흐름은 깨지지 않음 (HTML 자체는 유효)

## §5: 테스트 전략

### 단위 테스트 (vitest)

기존 `tests/unit/mail-template/image-align-roundtrip.test.ts` 재작성:
- wrapper width % 토글 roundtrip
- paragraph text-align attribute roundtrip
- "이미지+텍스트 같은 paragraph" → 자동 분리 검증 (plugin 동작)
- "이미지+이미지 같은 paragraph" → 분리 안 됨 검증
- 마이그레이션 무처리 (기존 float wrapperStyle 입력 → 그대로 보존, 정렬 attribute 는 paragraph 가 갖지 않음)

### 시각 검증 (수동)

1. 이미지 1장 70% 가운데
2. 이미지 1장 드래그로 320px → 우측 정렬
3. 이미지 2장 50%+50% → 같은 줄, 좌/중/우 모두 정상 정렬
4. 이미지 2장 30%+30% → 같은 줄 우측 정렬 시 우측에 묶여 보임
5. 이미지 옆에 텍스트 입력 시 자동 다음 줄
6. 표 옆에 이미지/텍스트 못 옴 (회귀 검증)
7. 미리보기 iframe / 실제 발송 메일 시각이 편집기와 일치
8. 설문 빌더(`kind === 'survey'`) notice 질문 에디터에서도 동일하게 이미지+텍스트 자동 분리 동작

### 검증 명령

ESLint 인프라 깨진 상태이므로 (`feedback_lint_infra_broken.md`):
- `pnpm tsc --noEmit` — 타입 검증
- `pnpm vitest tests/unit/mail-template` — 단위 테스트
- `pnpm build` — 빌드 회귀 검증

## 영향 범위

**수정 파일** (예상):
- `src/components/ui/rich-text-editor/image-context-toolbar.tsx` — wrapperStyle 단순화, 정렬을 paragraph text-align 으로
- `src/components/ui/rich-text-editor/extensions.ts` — mail/survey 양쪽에 imageTextSplitPlugin 추가, TextAlign extension 검토
- `src/components/ui/rich-text-editor/image-text-split-plugin.ts` — 신규
- `src/components/ui/rich-text-editor/rich-text-editor.tsx` — MAIL_BASE 의 text-align 안전망 추가 (필요 시)
- `src/app/globals.css` — float 룰 제거, 인접 wrapper margin 룰 추가
- `src/lib/mail/template-wrapper.tsx` — `<style>` 동일 룰
- `src/components/operations/mail-template/preview-dialog.tsx` — IFRAME_RESET_CSS 동일 룰
- `tests/unit/mail-template/image-align-roundtrip.test.ts` — 재작성

**예상 비변경**:
- `imageResize` 노드 schema 자체
- 이미지 업로드 / 첨부 / 발송 파이프라인
- 설문 빌더의 wrapper float 정렬 / 사이즈 토글 등 본 작업 범위 외 동작
  (단 이미지+텍스트 같은 paragraph 자동 분리는 mail/survey 양쪽 동일하게 적용)
