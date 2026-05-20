# 메일 에디터 이미지 같은 줄 inline 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메일 에디터에서 좁은 폭 이미지 두 장을 같은 paragraph 안 inline-block 으로 나란히 배치하고, 이미지+텍스트 같은 줄 혼용은 ProseMirror plugin 으로 자동 차단한다. 정렬은 wrapper float 대신 paragraph `text-align` 으로 통일.

**Architecture:**
- 이미지 정렬 = paragraph `textAlign` attribute (TipTap `@tiptap/extension-text-align` 이미 등록됨)
- 이미지 사이즈 = wrapper inline-style `width: N%` 또는 `width: Npx` (드래그 resize 결과 그대로)
- wrapper inline-style 에서 `float`, `margin: 0 auto`, padding 제거 → `display: inline-block; vertical-align: top; box-sizing: border-box; width: ...` 단일 형태
- 같은 paragraph 안 이미지+텍스트 공존 시 → ProseMirror `appendTransaction` plugin 이 자동으로 텍스트를 새 paragraph 로 split
- 편집기 wrapper 셀렉터 vs 미리보기/발송 `<img>` 셀렉터 구분 (`ImageResizeWithProxy.renderHTML` 에서 wrapper div 가 사라지고 wrapperStyle 이 img inline style 로 직렬화됨)

**Tech Stack:**
- @tiptap/react 3.x, @tiptap/extension-text-align (설치됨), tiptap-extension-resize-image
- @tiptap/pm (ProseMirror Plugin/PluginKey API)
- vitest + jsdom (단위 테스트)

---

## File Structure

**Created:**
- `src/components/ui/rich-text-editor/image-text-split-plugin.ts` — paragraph 내 image+text 공존 시 자동 split plugin
- `tests/unit/rich-text-editor/image-text-split-plugin.test.ts` — plugin 단위 테스트
- `tests/unit/rich-text-editor/image-align-paragraph.test.ts` — image NodeSelection 상태에서 paragraph textAlign 갱신 roundtrip

**Modified:**
- `src/components/ui/rich-text-editor/extensions.ts:201-244` — `createUnifiedExtensions` 의 mail kind 에 imageTextSplitPlugin 추가
- `src/components/ui/rich-text-editor/image-context-toolbar.tsx` — wrapper 인라인 스타일 단순화 (ALIGN_BASE → WRAPPER_BASE), 정렬을 paragraph textAlign 으로
- `src/app/globals.css:586-598, 686-692` — `.ProseMirror div[style*="float:"]` 제거, `.mail-editor-body p > div[wrapper] + div[wrapper] { margin-left: 8px }` 추가
- `src/components/operations/mail-template/preview-dialog.tsx:55-79` — IFRAME_RESET_CSS 의 img 셀렉터로 텍스트 align 안전망 + 인접 형제 margin
- `src/lib/mail/template-wrapper.tsx:77-79` — `<style>` 의 img 셀렉터로 동일 룰

**Note (gitignore):** `docs/` 가 `.gitignore` 에 등록되어 있어 신규 spec/plan 파일은 `git add -f` 로 강제 추가해야 함. 기존 spec/plan 들은 이미 tracked 상태.

---

## Task 1: 새 브랜치 + spec/plan force-add commit

**Files:**
- Read-only: `docs/superpowers/specs/2026-05-19-mail-editor-image-inline-design.md`, `docs/superpowers/plans/2026-05-19-mail-image-inline-paragraph.md`

- [ ] **Step 1: 새 feature 브랜치 생성**

```bash
git checkout -b feat/mail-image-inline-paragraph
```

기대: 새 브랜치로 전환됨.

- [ ] **Step 2: spec + plan 파일 force-add**

```bash
git add -f docs/superpowers/specs/2026-05-19-mail-editor-image-inline-design.md \
            docs/superpowers/plans/2026-05-19-mail-image-inline-paragraph.md
git status
```

기대: 두 파일이 staged 상태로 보임.

- [ ] **Step 3: commit**

```bash
git commit -m "docs: 메일 에디터 이미지 inline 배치 디자인+플랜 추가"
```

기대: 커밋 성공. `feedback_git_commit_korean.md` 메모리 컨벤션 준수.

---

## Task 2: imageTextSplitPlugin — 실패 테스트 작성

**Files:**
- Create: `tests/unit/rich-text-editor/image-text-split-plugin.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// tests/unit/rich-text-editor/image-text-split-plugin.test.ts
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { createUnifiedExtensions } from '@/components/ui/rich-text-editor/extensions';

function makeEditor(html: string) {
  return new Editor({
    extensions: createUnifiedExtensions({ kind: 'mail' }),
    content: html,
  });
}

describe('imageTextSplitPlugin (mail kind)', () => {
  it('이미지 + 텍스트 가 섞인 paragraph 는 두 paragraph 로 자동 분리된다', () => {
    const html =
      '<p><img src="https://example.com/a.png" style="display: inline-block; width: 50%;"/>안녕하세요</p>';
    const editor = makeEditor(html);

    // appendTransaction 이 동기적으로 즉시 실행되어 split 완료된 상태여야 함
    const json = editor.getJSON();
    const root = json.content ?? [];
    // 최소 2개 paragraph 가 생성 — 첫 paragraph 는 이미지, 두 번째는 텍스트
    expect(root.length).toBeGreaterThanOrEqual(2);

    const firstP = root[0];
    const secondP = root[1];
    expect(firstP.type).toBe('paragraph');
    expect(secondP.type).toBe('paragraph');

    const firstHasImage = (firstP.content ?? []).some((c) => c.type === 'imageResize');
    const firstHasText = (firstP.content ?? []).some(
      (c) => c.type === 'text' && (c.text ?? '').trim().length > 0,
    );
    const secondHasText = (secondP.content ?? []).some(
      (c) => c.type === 'text' && (c.text ?? '').trim().length > 0,
    );

    expect(firstHasImage).toBe(true);
    expect(firstHasText).toBe(false);
    expect(secondHasText).toBe(true);

    editor.destroy();
  });

  it('이미지 + 이미지 가 같은 paragraph 에 있으면 분리하지 않는다', () => {
    const html =
      '<p>' +
      '<img src="https://example.com/a.png" style="display: inline-block; width: 50%;"/>' +
      '<img src="https://example.com/b.png" style="display: inline-block; width: 50%;"/>' +
      '</p>';
    const editor = makeEditor(html);

    const json = editor.getJSON();
    const paragraphs = (json.content ?? []).filter((c) => c.type === 'paragraph');
    // 한 paragraph 에 이미지 두 개가 그대로 남아야 함
    expect(paragraphs.length).toBe(1);
    const imgs = (paragraphs[0].content ?? []).filter((c) => c.type === 'imageResize');
    expect(imgs.length).toBe(2);

    editor.destroy();
  });

  it('텍스트만 있는 paragraph 는 그대로 둔다', () => {
    const html = '<p>plain text</p>';
    const editor = makeEditor(html);

    const json = editor.getJSON();
    const paragraphs = (json.content ?? []).filter((c) => c.type === 'paragraph');
    expect(paragraphs.length).toBe(1);

    editor.destroy();
  });

  it('survey kind 에서도 동일하게 분리된다 (mail+survey 양쪽 적용)', () => {
    const html =
      '<p><img src="https://example.com/a.png" style="display: inline-block; width: 50%;"/>같이</p>';
    const editor = new Editor({
      extensions: createUnifiedExtensions({ kind: 'survey' }),
      content: html,
    });

    const json = editor.getJSON();
    const paragraphs = (json.content ?? []).filter((c) => c.type === 'paragraph');
    // survey 모드도 plugin 적용 — paragraph 가 분리되어 2개 이상
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);

    editor.destroy();
  });
});
```

- [ ] **Step 2: 테스트 실행해 fail 확인**

```bash
pnpm vitest tests/unit/rich-text-editor/image-text-split-plugin.test.ts --run
```

기대: 첫 세 테스트는 FAIL (plugin 미구현 → split 동작 안 함, paragraph 그대로). 네 번째 (survey 모드) 는 PASS 가능성 있음.

---

## Task 3: imageTextSplitPlugin — 최소 구현

**Files:**
- Create: `src/components/ui/rich-text-editor/image-text-split-plugin.ts`

- [ ] **Step 1: plugin 파일 작성**

```typescript
// src/components/ui/rich-text-editor/image-text-split-plugin.ts
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { type Node as PMNode, Fragment } from '@tiptap/pm/model';

const IMAGE_NODE = 'imageResize';

export const imageTextSplitPluginKey = new PluginKey('imageTextSplit');

interface Offender {
  pos: number;
  node: PMNode;
}

function findFirstOffender(doc: PMNode): Offender | null {
  let found: Offender | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== 'paragraph') return true;

    let hasImage = false;
    let hasMeaningfulText = false;
    node.forEach((child) => {
      if (child.type.name === IMAGE_NODE) hasImage = true;
      else if (child.isText && (child.text ?? '').trim().length > 0) hasMeaningfulText = true;
    });

    if (hasImage && hasMeaningfulText) {
      found = { pos, node };
      return false;
    }
    return false;
  });
  return found;
}

// 이미지 paragraph 와 텍스트 paragraph 두 개로 분리한 새 paragraph 노드 쌍 반환.
function splitParagraph(paragraph: PMNode): PMNode[] {
  const imageChildren: PMNode[] = [];
  const textChildren: PMNode[] = [];

  paragraph.forEach((child) => {
    if (child.type.name === IMAGE_NODE) imageChildren.push(child);
    else textChildren.push(child);
  });

  // paragraph 의 attrs (textAlign 등) 는 이미지 paragraph 에 그대로 유지.
  // 텍스트 paragraph 는 default attrs (textAlign 없음).
  const imagePara = paragraph.type.create(paragraph.attrs, Fragment.from(imageChildren));
  const textPara = paragraph.type.create(null, Fragment.from(textChildren));

  return [imagePara, textPara];
}

export function imageTextSplitPlugin() {
  return new Plugin({
    key: imageTextSplitPluginKey,
    appendTransaction(_transactions, _oldState, newState) {
      // 한 번에 한 paragraph 씩 분리. plugin 이 재호출되며 모든 위반 paragraph 가 차례로 해소됨.
      const offender = findFirstOffender(newState.doc);
      if (!offender) return null;

      const [imagePara, textPara] = splitParagraph(offender.node);
      const tr = newState.tr;
      tr.replaceWith(offender.pos, offender.pos + offender.node.nodeSize, [imagePara, textPara]);
      return tr;
    },
  });
}
```

- [ ] **Step 2: plugin 을 mail kind 에 등록**

`src/components/ui/rich-text-editor/extensions.ts` 의 `createUnifiedExtensions` 함수를 수정:

**현재 (line 201-244)**:
```typescript
export function createUnifiedExtensions(options: CreateUnifiedExtensionsOptions = {}): AnyExtension[] {
  const kind = options.kind ?? 'survey';
  // ...
  return [
    StarterKit.configure({ /* ... */ }),
    Underline,
    Strike,
    TextStyle,
    FontSize,
    TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right', 'justify'], defaultAlignment: 'left' }),
    Link.configure({ /* ... */ }),
    ImageResizeWithProxy.configure({ inline: true, allowBase64: true }),
    TableExtended.configure({ /* ... */ }),
    TableRow,
    TableHeaderExtended,
    TableCellExtended,
    TrailingNode,
    TableSelectOnBackspace,
    VarTokenExtension,
    TableAlignDecoration,
  ];
}
```

**변경 후**: 파일 상단 import 추가 + return 배열 끝에 mail kind 한정 plugin extension 추가.

```typescript
// imports 추가 (파일 상단, 다른 import 옆)
import { imageTextSplitPlugin } from './image-text-split-plugin';

// createUnifiedExtensions 안에 mail kind 전용 extension 정의 (return 직전)
const ImageTextSplitExtension = Extension.create({
  name: 'imageTextSplit',
  addProseMirrorPlugins() {
    return [imageTextSplitPlugin()];
  },
});

// return 배열을 다음과 같이 변경:
return [
  StarterKit.configure({ /* 기존 그대로 */ }),
  Underline,
  Strike,
  TextStyle,
  FontSize,
  TextAlign.configure({ /* 기존 그대로 */ }),
  Link.configure({ /* 기존 그대로 */ }),
  ImageResizeWithProxy.configure({ inline: true, allowBase64: true }),
  TableExtended.configure({ /* 기존 그대로 */ }),
  TableRow,
  TableHeaderExtended,
  TableCellExtended,
  TrailingNode,
  TableSelectOnBackspace,
  VarTokenExtension,
  TableAlignDecoration,
  // 이미지+텍스트 같은 줄 자동 분리 (mail/survey 양쪽 모두 적용)
  ImageTextSplitExtension,
];
```

- [ ] **Step 3: 테스트 실행해 pass 확인**

```bash
pnpm vitest tests/unit/rich-text-editor/image-text-split-plugin.test.ts --run
```

기대: 네 테스트 모두 PASS.

- [ ] **Step 4: 기존 extensions.test.ts 회귀 검증**

```bash
pnpm vitest tests/unit/rich-text-editor --run
```

기대: 모든 테스트 PASS. mail/survey roundtrip 영향 없음.

- [ ] **Step 5: commit**

```bash
git add src/components/ui/rich-text-editor/image-text-split-plugin.ts \
        src/components/ui/rich-text-editor/extensions.ts \
        tests/unit/rich-text-editor/image-text-split-plugin.test.ts
git commit -m "feat: 메일 에디터 이미지+텍스트 같은 줄 분리 plugin 추가"
```

---

## Task 4: paragraph textAlign 갱신/조회 — 실패 테스트 작성

이미지 NodeSelection 상태에서 paragraph 의 textAlign attribute 를 변경하는 로직을 검증. 핵심: TipTap `TextAlign` extension 의 `setTextAlign` 명령이 image NodeSelection 에서도 부모 paragraph 에 적용되는지, 안 되면 fallback 으로 직접 paragraph attrs 갱신.

**Files:**
- Create: `tests/unit/rich-text-editor/image-align-paragraph.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// tests/unit/rich-text-editor/image-align-paragraph.test.ts
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { createUnifiedExtensions } from '@/components/ui/rich-text-editor/extensions';

function makeEditor(html: string) {
  return new Editor({
    extensions: createUnifiedExtensions({ kind: 'mail' }),
    content: html,
  });
}

// image NodeSelection 위치 찾기 — 첫 imageResize 노드의 pos.
function findImagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'imageResize' && pos === -1) {
      pos = p;
      return false;
    }
  });
  if (pos === -1) throw new Error('imageResize 노드를 찾을 수 없음');
  return pos;
}

describe('paragraph textAlign — image NodeSelection 기반', () => {
  it('이미지를 선택하고 setTextAlign("center") 호출 시 부모 paragraph 의 textAlign 이 갱신된다', () => {
    const html = '<p><img src="https://example.com/a.png" style="display: inline-block; width: 50%;"/></p>';
    const editor = makeEditor(html);

    const imgPos = findImagePos(editor);
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imgPos));
    editor.view.dispatch(tr);

    editor.chain().focus().setTextAlign('center').run();

    const html2 = editor.getHTML();
    expect(html2).toMatch(/text-align:\s*center/);

    editor.destroy();
  });

  it('paragraph textAlign 은 HTML roundtrip 으로 보존된다', () => {
    const html = '<p style="text-align: right"><img src="https://example.com/a.png" style="display: inline-block; width: 50%;"/></p>';
    const editor = makeEditor(html);

    const out = editor.getHTML();
    expect(out).toMatch(/text-align:\s*right/);

    editor.destroy();
  });

  it('두 이미지가 같은 paragraph 안에 있을 때 setTextAlign 은 둘 다에 영향 (paragraph 단위 정렬)', () => {
    const html =
      '<p>' +
      '<img src="https://example.com/a.png" style="display: inline-block; width: 30%;"/>' +
      '<img src="https://example.com/b.png" style="display: inline-block; width: 30%;"/>' +
      '</p>';
    const editor = makeEditor(html);

    const imgPos = findImagePos(editor); // 첫 이미지
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imgPos));
    editor.view.dispatch(tr);

    editor.chain().focus().setTextAlign('center').run();

    const out = editor.getHTML();
    // paragraph 한 개에 text-align: center 가 박힘 — 그 paragraph 안 두 이미지 모두 동일 정렬
    const paragraphCount = (out.match(/text-align:\s*center/g) ?? []).length;
    expect(paragraphCount).toBe(1);

    editor.destroy();
  });
});
```

- [ ] **Step 2: 테스트 실행해 동작 검증**

```bash
pnpm vitest tests/unit/rich-text-editor/image-align-paragraph.test.ts --run
```

기대 케이스 A: 세 테스트 모두 PASS. (TextAlign extension 이 image NodeSelection 의 parent paragraph 에 자동 적용)

기대 케이스 B: 첫/세 번째 테스트 FAIL — `setTextAlign` 이 image NodeSelection 에서 동작 안 함. → Step 3 의 fallback 헬퍼가 필요.

- [ ] **Step 3: (B 케이스일 때만) fallback 헬퍼 추가**

만약 Step 2 가 FAIL 이면 `src/components/ui/rich-text-editor/image-context-toolbar.tsx` 안에 헬퍼를 추가하기 전, 임시 검증용 헬퍼를 테스트 파일 안에 두고 동작 확인:

```typescript
// 헬퍼: image NodeSelection 의 부모 paragraph attrs.textAlign 직접 갱신
function setParentParagraphTextAlign(editor: Editor, imgPos: number, value: 'left' | 'center' | 'right') {
  const $pos = editor.state.doc.resolve(imgPos);
  const paraDepth = $pos.depth; // imageResize 가 paragraph 자식이므로 paragraph 는 depth = $pos.depth
  const paraPos = $pos.before(paraDepth);
  const paraNode = $pos.parent;
  const tr = editor.state.tr.setNodeMarkup(paraPos, undefined, {
    ...paraNode.attrs,
    textAlign: value,
  });
  editor.view.dispatch(tr);
}
```

이 헬퍼로 동일 테스트가 통과하는지 확인 후, Task 5 에서 정식 위치(image-context-toolbar.tsx)로 옮긴다.

- [ ] **Step 4: commit (테스트만)**

```bash
git add tests/unit/rich-text-editor/image-align-paragraph.test.ts
git commit -m "test: paragraph textAlign 갱신 테스트 추가"
```

---

## Task 5: ImageContextToolbar — 정렬 동작을 paragraph textAlign 으로 교체

**Files:**
- Modify: `src/components/ui/rich-text-editor/image-context-toolbar.tsx`

- [ ] **Step 1: align 읽기 로직 — paragraph attrs 기반으로 교체**

현재 ([image-context-toolbar.tsx:37-43](src/components/ui/rich-text-editor/image-context-toolbar.tsx#L37-L43)):
```typescript
function readAlign(wrapperStyle: string): Align {
  if (/float:\s*right/.test(wrapperStyle)) return 'right';
  if (/display:\s*block/.test(wrapperStyle) && /margin:\s*0\s*auto/.test(wrapperStyle)) {
    return 'center';
  }
  return 'left';
}
```

변경: 함수 자체는 제거(또는 옛 데이터 호환 헬퍼로 강등). 새 읽기 로직은 `useEditorState` 안에서 직접 paragraph attrs 조회.

`useEditorState` selector 변경 (line 94-107):
```typescript
const s = useEditorState({
  editor,
  selector: ({ editor }) => {
    if (!editor) {
      return { align: 'left' as Align, widthPct: null as number | null };
    }
    // 선택된 image 의 부모 paragraph attrs.textAlign 을 읽음.
    // selection 이 image NodeSelection 이거나, image 근처 cursor 위치일 때 동작.
    const attrs = editor.getAttributes('imageResize');
    const wrapperStyle = (attrs.wrapperStyle ?? '') as string;
    const paraAttrs = editor.getAttributes('paragraph');
    const rawAlign = (paraAttrs.textAlign as string | null | undefined) ?? null;
    const align: Align =
      rawAlign === 'center' || rawAlign === 'right' ? rawAlign : 'left';
    return {
      align,
      widthPct: readWidthPct(wrapperStyle),
    };
  },
});
```

- [ ] **Step 2: setAlign — paragraph textAlign 갱신 + wrapperStyle 정규화**

현재 ([image-context-toolbar.tsx:115-131](src/components/ui/rich-text-editor/image-context-toolbar.tsx#L115-L131)):
```typescript
const setAlign = (target: Align) => {
  if (selectedImagePos === null) return;
  const currentNode = editor.state.doc.nodeAt(selectedImagePos);
  const existingWrapperStyle = (currentNode?.attrs.wrapperStyle ?? '') as string;
  const widthMatch = existingWrapperStyle.match(/width:\s*[\d.]+%/);
  const widthPart = widthMatch ? `${widthMatch[0]};` : '';
  const wrapperStyle = widthPart ? `${ALIGN_BASE[target]} ${widthPart}` : ALIGN_BASE[target];
  editor.chain().focus()
    .setNodeSelection(selectedImagePos)
    .updateAttributes(IMAGE_NODE, { wrapperStyle, containerStyle: 'width: 100%; height: auto;' })
    .run();
};
```

변경:
```typescript
const setAlign = (target: Align) => {
  if (selectedImagePos === null) return;

  // 1) image NodeSelection 의 부모 paragraph 의 textAlign 을 갱신.
  //    TipTap setTextAlign 명령이 image NodeSelection 에서 부모 paragraph 를 못 잡는 경우를
  //    대비해 직접 setNodeMarkup 으로 paragraph attrs 를 변경한다.
  const $pos = editor.state.doc.resolve(selectedImagePos);
  if ($pos.depth < 1) return; // 가드: 최상위에 이미지가 직접 있을 수는 없지만 안전망
  const paraPos = $pos.before($pos.depth);
  const paraNode = $pos.parent;

  // 2) wrapperStyle 을 새 모델로 정규화 — width(% 또는 px) 만 유지, 정렬/패딩 제거.
  const currentNode = editor.state.doc.nodeAt(selectedImagePos);
  const existingWrapperStyle = (currentNode?.attrs.wrapperStyle ?? '') as string;
  const widthMatch =
    existingWrapperStyle.match(/width:\s*[\d.]+(%|px)/i);
  const widthPart = widthMatch ? ` ${widthMatch[0]};` : '';
  const newWrapperStyle = `${WRAPPER_BASE}${widthPart}`;

  const tr = editor.state.tr
    .setNodeMarkup(paraPos, undefined, { ...paraNode.attrs, textAlign: target })
    .setNodeMarkup(selectedImagePos, undefined, {
      ...currentNode!.attrs,
      wrapperStyle: newWrapperStyle,
      containerStyle: 'width: 100%; height: auto;',
    });
  editor.view.dispatch(tr);
  editor.commands.focus();
};
```

- [ ] **Step 3: 컴포넌트 build 확인 (TypeScript)**

```bash
pnpm tsc --noEmit
```

기대: TypeScript 에러 없음. (WRAPPER_BASE 상수는 다음 Task 에서 정의하므로 지금 일단 import/선언만 — Task 6 에서 정식 정의)

임시 조치: 같은 파일 상단에 `WRAPPER_BASE` 임시 선언 추가 (Task 6 에서 ALIGN_BASE 완전 제거 시 같은 자리로 정리):
```typescript
const WRAPPER_BASE = 'display: inline-block; vertical-align: top; box-sizing: border-box;';
```

`ALIGN_BASE` 는 일단 남겨두고 (다른 코드가 참조 안 한다면 ESLint 경고만), Task 6 에서 완전히 제거.

- [ ] **Step 4: Task 4 테스트 재실행 (이제 ImageContextToolbar 가 동작 안 하더라도 테스트는 직접 setTextAlign 호출이므로 영향 없음)**

```bash
pnpm vitest tests/unit/rich-text-editor --run
```

기대: 모든 테스트 PASS.

- [ ] **Step 5: commit**

```bash
git add src/components/ui/rich-text-editor/image-context-toolbar.tsx
git commit -m "feat: 이미지 정렬을 paragraph textAlign 으로 전환"
```

---

## Task 6: ImageContextToolbar — wrapper 스타일 단순화 + setSize 갱신

**Files:**
- Modify: `src/components/ui/rich-text-editor/image-context-toolbar.tsx`

- [ ] **Step 1: ALIGN_BASE 제거, WRAPPER_BASE 정식 도입**

현재 (line 20-29):
```typescript
const ALIGN_BASE: Record<Align, string> = {
  left:  'display: inline-block; float: left;  vertical-align: top; box-sizing: border-box; padding-right: 4px;',
  right: 'display: inline-block; float: right; vertical-align: top; box-sizing: border-box; padding-left: 4px;',
  center:'display: block; margin: 0 auto;     vertical-align: top; box-sizing: border-box;',
};
```

변경:
```typescript
// wrapper 인라인 스타일 공통 — 정렬은 paragraph textAlign 으로 분리.
// width 는 setSize 또는 드래그 resize 결과로 별도 append.
const WRAPPER_BASE = 'display: inline-block; vertical-align: top; box-sizing: border-box;';

function buildWrapperStyle(widthPct: number): string {
  return `${WRAPPER_BASE} width: ${widthPct}%;`;
}
```

- [ ] **Step 2: setSize 갱신 — ALIGN_BASE 의존 제거**

현재 (line 136-151):
```typescript
const setSize = (pct: SizePct) => {
  if (selectedImagePos === null) return;
  const isToggleOff = s.widthPct === pct;
  const wrapperStyle = isToggleOff ? ALIGN_BASE[s.align] : buildWrapperStyle(s.align, pct);
  editor.chain().focus()
    .setNodeSelection(selectedImagePos)
    .updateAttributes(IMAGE_NODE, {
      wrapperStyle, containerStyle: 'width: 100%; height: auto;', width: null, height: null,
    })
    .run();
};
```

변경:
```typescript
const setSize = (pct: SizePct) => {
  if (selectedImagePos === null) return;
  const isToggleOff = s.widthPct === pct;
  // toggle off → 자연 사이즈 복귀 (width 제거), on → width N%
  const wrapperStyle = isToggleOff ? WRAPPER_BASE : buildWrapperStyle(pct);
  editor.chain().focus()
    .setNodeSelection(selectedImagePos)
    .updateAttributes(IMAGE_NODE, {
      wrapperStyle,
      containerStyle: 'width: 100%; height: auto;',
      width: null,
      height: null,
    })
    .run();
};
```

- [ ] **Step 3: buildWrapperStyle 시그니처 변경 호환**

`buildWrapperStyle` 가 기존에 `(align, widthPct)` 두 인자였는데 새 시그니처는 `(widthPct)`. 호출처는 setSize 하나뿐이라 위 변경에 이미 반영됨.

- [ ] **Step 4: TypeScript 검증**

```bash
pnpm tsc --noEmit
```

기대: 에러 없음. ALIGN_BASE 참조 코드가 모두 제거된 상태.

- [ ] **Step 5: 단위 테스트 재실행**

```bash
pnpm vitest tests/unit/rich-text-editor --run
```

기대: 전부 PASS.

- [ ] **Step 6: commit**

```bash
git add src/components/ui/rich-text-editor/image-context-toolbar.tsx
git commit -m "refactor: 이미지 wrapper 스타일을 width 만 남기도록 단순화"
```

---

## Task 7: globals.css — float 룰 제거 + 인접 wrapper margin + 안전망

**Files:**
- Modify: `src/app/globals.css:586-598, 684-692`

- [ ] **Step 1: float 룰 제거 + 안전망 추가**

`src/app/globals.css` 의 591-598 라인 (현재):
```css
/* float 스타일이 적용된 이미지 래퍼 - 크기 제한 해제 */
.ProseMirror div[style*="float: left"] {
  margin-right: 8px !important;
}

.ProseMirror div[style*="float: right"] {
  margin-left: 8px !important;
}
```

변경 후 (전체 교체):
```css
/* 메일 에디터 — 같은 paragraph 안 인접 이미지 wrapper 사이 간격
   (wrapper 두 개가 paragraph 안 inline-block 으로 나란히 있을 때 8px gap) */
.mail-editor-body .ProseMirror p > div[style*="cursor: pointer"] + div[style*="cursor: pointer"] {
  margin-left: 8px;
}

/* 옛 데이터 안전망 — 기존에 float 으로 저장된 wrapper 가 새 모델에서
   inline-block 으로 동작하도록 강제. 정렬 정보(좌/중/우) 는 손실 — 운영자가
   메일 템플릿을 열어 정렬 버튼을 다시 누르면 paragraph textAlign 으로 옮겨감. */
.mail-editor-body .ProseMirror div[style*="float:"] {
  float: none !important;
  display: inline-block !important;
}
```

- [ ] **Step 2: MAIL_BASE 안 `.mail-editor-body p` 룰 확인 — 변경 없이 유지**

line 684-692 (그대로):
```css
.mail-editor-body p {
  display: block !important;
  clear: both !important;
}
.mail-editor-body ul,
.mail-editor-body ol,
.mail-editor-body table {
  clear: both !important;
}
```

- [ ] **Step 3: 빌드 + 단위 테스트 회귀**

```bash
pnpm build
```

기대: 빌드 성공. CSS 룰만 변경이라 회귀 없음.

```bash
pnpm vitest --run
```

기대: 모든 단위 테스트 PASS.

- [ ] **Step 4: commit**

```bash
git add src/app/globals.css
git commit -m "refactor: 메일 에디터 CSS 의 float 룰을 inline-block 으로 단순화"
```

---

## Task 8: preview-dialog.tsx IFRAME_RESET_CSS — img 셀렉터로 동기화

**Files:**
- Modify: `src/components/operations/mail-template/preview-dialog.tsx:55-79`

- [ ] **Step 1: IFRAME_RESET_CSS 갱신**

현재 (line 55-79):
```typescript
const IFRAME_RESET_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { /* ... */ }
  p { margin: 0 0 0.5em 0; clear: both; }
  p:last-child { margin-bottom: 0; }
  ul { list-style: disc; padding-left: 24px; margin: 0.5em 0; clear: both; }
  ol { list-style: decimal; padding-left: 24px; margin: 0.5em 0; clear: both; }
  li { margin: 0.2em 0; }
  table { border-collapse: collapse; margin: 0.5em 0; clear: both; }
  td, th { border: 1px solid #d1d5db; padding: 4px 8px; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
`;
```

변경: 마지막 `img` 룰을 더 상세하게 + paragraph 내 인접 형제 margin 추가.

기존 `img { max-width: 100%; height: auto; }` 라인을 다음으로 교체:
```css
  /* 메일 에디터의 wrapperStyle (display: inline-block; width: N%) 가 img inline style 로
     직렬화되므로, p 안 img 는 paragraph text-align 에 따라 정렬됨. 옛 데이터의 float 잔존을
     무력화하는 안전망 + 인접 img 사이 8px gap. */
  img { max-width: 100%; height: auto; }
  p img {
    display: inline-block !important;
    float: none !important;
    vertical-align: top;
  }
  p > img + img { margin-left: 8px; }
```

- [ ] **Step 2: 빌드 회귀 검증**

```bash
pnpm build
```

기대: 빌드 성공.

- [ ] **Step 3: commit**

```bash
git add src/components/operations/mail-template/preview-dialog.tsx
git commit -m "refactor: 미리보기 iframe CSS 를 img 인라인 정렬 모델로 갱신"
```

---

## Task 9: template-wrapper.tsx 발송용 `<style>` — img 셀렉터 동기화

**Files:**
- Modify: `src/lib/mail/template-wrapper.tsx:77-79`

- [ ] **Step 1: `<style>` 룰 확장**

현재 (line 77-79):
```tsx
<style>{`
  p, ul, ol, table { clear: both; }
`}</style>
```

변경:
```tsx
<style>{`
  p, ul, ol, table { clear: both; }
  /* wrapperStyle 이 img inline style 로 직렬화되므로 (extensions.ts 의
     ImageResizeWithProxy.renderHTML 참조), p 안 img 는 paragraph text-align 에 따라 정렬.
     옛 데이터의 float 잔존 안전망 + 인접 img 사이 8px gap.
     Gmail/Outlook 일부 클라이언트가 <style> 룰을 무시할 수 있으나, 새 데이터는 img inline
     style 에 float 이 없어 영향 0 — 옛 데이터만 잠재적 시각 차이. */
  p img { display: inline-block !important; float: none !important; vertical-align: top; }
  p > img + img { margin-left: 8px; }
`}</style>
```

- [ ] **Step 2: 빌드 + 단위 테스트 회귀**

```bash
pnpm build && pnpm vitest --run
```

기대: 둘 다 성공.

- [ ] **Step 3: commit**

```bash
git add src/lib/mail/template-wrapper.tsx
git commit -m "refactor: 메일 발송 wrapper CSS 를 img 인라인 정렬 모델로 갱신"
```

---

## Task 10: 통합 검증 (tsc + vitest + build)

**Files:**
- 검증만 — 코드 변경 없음

- [ ] **Step 1: TypeScript 전체 검증**

```bash
pnpm tsc --noEmit
```

기대: 에러 0.

- [ ] **Step 2: 전체 vitest**

```bash
pnpm vitest --run
```

기대: 모든 테스트 PASS. 메모리(`feedback_lint_infra_broken.md`) 에 따라 ESLint 는 깨진 상태이므로 lint 는 건너뛰고 tsc + vitest 로 대체 검증.

- [ ] **Step 3: production build**

```bash
pnpm build
```

기대: 빌드 성공. Next.js 16 + Turbopack 환경 회귀 없음.

- [ ] **Step 4: 검증 결과 commit 불필요 (코드 변경 없음)**

검증만 통과시키고 다음 task 로.

---

## Task 11: 수동 시각 검증 + PR 준비

**Files:**
- 검증만 — 개발 서버 띄워 수동 확인

- [ ] **Step 1: 개발 서버 기동**

```bash
pnpm dev
```

별도 터미널에서 브라우저 열기: `http://localhost:3000/admin/surveys/<surveyId>/operations/mail-template`

- [ ] **Step 2: 시각 검증 체크리스트**

각 항목 직접 확인 후 체크:
- [ ] 이미지 1장 70% + 가운데 정렬 → 부모 100% 안에서 70% inline-block 이 가운데 표시
- [ ] 이미지 1장 드래그로 ~320px + 우측 정렬 → 우측에 320px 이미지 표시
- [ ] 이미지 2장 연속 삽입 후 둘 다 50% → 같은 줄 50%+50% 로 나란히 (좌/중/우 정렬 모두 정상)
- [ ] 이미지 2장 30%+30% + 우측 정렬 → 두 묶음이 paragraph 우측에 붙음
- [ ] 이미지 옆에 글자 입력 시 자동으로 다음 줄 (paragraph 분리)
- [ ] 표 옆에 이미지/텍스트 못 옴 (회귀 검증)
- [ ] 미리보기 다이얼로그 iframe 시각이 편집기와 일치
- [ ] 테스트 발송 → 실제 메일 시각이 편집기 + iframe 과 일치
- [ ] 설문 빌더(`/admin/surveys/<surveyId>/edit`) 의 notice 질문 에디터 — 이미지+텍스트 자동 분리 동작 검증 (mail/survey 동일)
- [ ] 설문 빌더 이미지의 wrapper float/사이즈 토글 등 본 작업 범위 외 동작 회귀 없음

- [ ] **Step 3: 옛 데이터 안전망 검증 (있다면)**

기존에 메일 템플릿을 저장한 설문이 있으면 그 템플릿을 열어:
- [ ] 옛 float 기반 이미지가 좌측에 inline-block 으로 표시됨 (정렬 정보 손실은 의도된 동작)
- [ ] 이미지 클릭 + 정렬 버튼 한 번 누르면 paragraph textAlign 으로 정상 옮겨감
- [ ] 미리보기 + 발송 시 시각이 동일

- [ ] **Step 4: PR 생성**

```bash
git push -u origin feat/mail-image-inline-paragraph
gh pr create --title "feat: 메일 에디터 이미지 같은 줄 inline 배치" --body "$(cat <<'EOF'
## Summary
- 메일 에디터에서 좁은 폭 이미지 두 장을 같은 paragraph 안 inline-block 으로 나란히 배치
- 이미지+텍스트 같은 줄 혼용을 ProseMirror plugin 으로 자동 차단
- 정렬을 wrapper float 에서 paragraph textAlign 으로 전환

## Design / Plan
- spec: docs/superpowers/specs/2026-05-19-mail-editor-image-inline-design.md
- plan: docs/superpowers/plans/2026-05-19-mail-image-inline-paragraph.md

## Test plan
- [x] pnpm tsc --noEmit
- [x] pnpm vitest --run (image-text-split-plugin + image-align-paragraph + 기존 회귀)
- [x] pnpm build
- [x] 시각 검증 (편집기, 미리보기, 실 발송 메일)
- [x] 옛 데이터 안전망 확인

## Known Limitations
- 옛 메일 템플릿의 정렬 정보(좌/중/우) 는 손실 — 운영자가 메일 편집기에서 다시 정렬 버튼을 누르면 paragraph textAlign 으로 복구
- 같은 줄 안에서 이미지마다 다른 정렬 (예: 첫 장 좌, 두 번째 우) 은 불가 — paragraph 단위 정렬 그룹 한 축
EOF
)"
```

기대: PR URL 출력. 사용자 리뷰 대기.

---

## Self-Review Notes

**1. Spec coverage:**
- §1 imageTextSplitPlugin → Task 2-3
- §2 wrapper 인라인 스타일 단순화 + paragraph text-align → Task 5-6
- §3 globals.css 룰 정리 → Task 7
- §3 preview-dialog IFRAME_RESET_CSS → Task 8
- §3 template-wrapper `<style>` → Task 9
- §4 마이그레이션 안전망 → Task 7 Step 1 + Task 8/9 안전망 룰
- §5 단위 테스트 → Task 2 + Task 4
- §5 시각 검증 → Task 11
- §5 검증 명령 (tsc + vitest + build) → Task 10

**2. Placeholder scan:** 모든 step 에 실제 코드 또는 명령 포함. "TBD" / "구현 필요" 같은 표현 없음.

**3. Type consistency:** `WRAPPER_BASE`, `buildWrapperStyle(widthPct)`, `setAlign(target)`, `setSize(pct)`, `imageTextSplitPlugin()`, `imageTextSplitPluginKey` 명명 일관. paragraph attrs 갱신 시 `setNodeMarkup` 사용 통일.
