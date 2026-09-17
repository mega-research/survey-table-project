import { type AnyExtension, Extension } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import History from '@tiptap/extension-history';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';

import { FontColor } from './font-color-mark';
import { FontSize } from './font-size-mark';
import { createVarTokenPlugin } from './var-token-plugin';

const VarTokenExtension = Extension.create({
  name: 'varToken',
  addProseMirrorPlugins() {
    return [createVarTokenPlugin()];
  },
});

/**
 * 표 셀 본문 편집기의 스키마 — 문단·줄바꿈·굵게·글자색뿐.
 * 셀 본문은 평문 정본(`TableCell.content`)과 1:1 로 오가야 해서 그 밖의 노드·마크는
 * 아예 두지 않는다. 붙여넣기로 들어온 이미지·링크·표·글꼴은 스키마가 떨어뜨린다.
 * sanitizeCellHtml(lib/sanitize.ts) 의 허용 집합과 같아야 한다.
 */
export function createInlineCellExtensions(): AnyExtension[] {
  return [Document, Paragraph, Text, Bold, HardBreak, History, FontColor, VarTokenExtension];
}

/** Enter·Shift+Enter 를 먹는다 — 한 줄 제목에 문단·줄바꿈이 생기지 않게. */
const SingleLineExtension = Extension.create({
  name: 'singleLine',
  addKeyboardShortcuts() {
    return { Enter: () => true, 'Shift-Enter': () => true };
  },
});

/**
 * 문항 제목 편집기의 스키마 — 셀 본문 스키마에 밑줄·글자 크기를 더하고 줄바꿈을 막는다.
 * sanitizeTitleHtml(lib/sanitize.ts) 의 허용 집합과 같아야 한다.
 */
export function createInlineTitleExtensions(): AnyExtension[] {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Underline,
    History,
    FontColor,
    FontSize,
    VarTokenExtension,
    SingleLineExtension,
  ];
}
