import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import { findTableAtSelection } from '@/lib/tiptap/find-table';

import { parseCaptionAlign, captionAlignStyle, type HAlign } from './table-attrs-helpers';

export const TableCaption = Node.create({
  name: 'tableCaption',
  // 'block' 그룹에 넣지 않음 — 표 밖에서 단독 삽입되는 사고 방지
  content: 'inline*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      align: {
        default: 'center',
        parseHTML: (el) => parseCaptionAlign(el as HTMLElement),
        renderHTML: (attrs) => ({
          style: captionAlignStyle(attrs.align as HAlign),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'caption' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['caption', HTMLAttributes, 0];
  },
});

/**
 * 현재 셀렉션이 있는 표의 첫 자식으로 캡션을 토글한다.
 * - 캡션이 이미 있으면 제거
 * - 없으면 빈 캡션 노드 삽입 + 캡션 안으로 포커스 이동
 * - 셀렉션이 표 밖이면 no-op
 */
export function toggleTableCaption(editor: Editor): boolean {
  const { state, view } = editor;
  const found = findTableAtSelection(state);
  if (!found) return false;

  const { node: tableNode, pos: tablePos } = found;
  const firstChild = tableNode.firstChild;
  const insertPos = tablePos + 1;

  if (firstChild?.type.name === 'tableCaption') {
    view.dispatch(state.tr.delete(insertPos, insertPos + firstChild.nodeSize));
    editor.commands.focus();
    return true;
  }

  // TipTap의 insertContentAt은 schema 매칭 실패 시 inline으로 fallback돼
  // 캡션 노드가 셀 안으로 빨려들어가는 문제가 있다. transaction으로 직접 삽입.
  const captionType = state.schema.nodes.tableCaption;
  if (!captionType) return false;

  const tr = state.tr.insert(insertPos, captionType.create({ align: 'center' }));
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}
