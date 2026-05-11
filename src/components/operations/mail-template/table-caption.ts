import { Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

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
  if (!editor.isActive('table')) return false;

  const { state } = editor;
  const { selection, schema } = state;
  const $pos = selection.$from;

  // 커서 위치에서 부모 체인을 거슬러 올라가며 table 노드 찾기
  let tablePos: number | null = null;
  let tableNode: ProseMirrorNode | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') {
      tablePos = $pos.before(d);
      tableNode = node;
      break;
    }
  }

  if (tablePos === null || !tableNode) return false;

  const firstChild = tableNode.firstChild;
  const insertPos = tablePos + 1; // 표 노드 안의 첫 위치

  if (firstChild?.type.name === 'tableCaption') {
    // 캡션 제거
    return editor
      .chain()
      .focus()
      .deleteRange({ from: insertPos, to: insertPos + firstChild.nodeSize })
      .run();
  }

  // 캡션 신규 삽입 — 빈 inline content
  const captionType = schema.nodes.tableCaption;
  if (!captionType) return false;
  const captionNode = captionType.create({ align: 'center' });

  return editor
    .chain()
    .focus()
    .insertContentAt(insertPos, captionNode, { updateSelection: false })
    .setTextSelection(insertPos + 1) // 캡션 안으로 커서
    .run();
}
