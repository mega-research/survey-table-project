import { Extension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * 빈 paragraph에 커서가 있을 때 Backspace/Delete로 인접 표를 NodeSelection 으로 선택한다.
 * 한 번 더 누르면 ProseMirror 기본 deleteSelection 이 표를 삭제.
 *
 * TipTap 기본 joinBackward 는 빈 paragraph 에서 Backspace 시 직전 표의 마지막 셀로
 * 커서를 빨아들여 표 자체를 지울 수 없는 문제를 해결한다.
 */
export const TableSelectOnBackspace = Extension.create({
  name: 'tableSelectOnBackspace',

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;

        const { $from } = selection;
        if ($from.parent.type.name !== 'paragraph') return false;
        if ($from.parentOffset !== 0) return false;
        if ($from.parent.content.size !== 0) return false;

        const paragraphPos = $from.before($from.depth);
        const before = state.doc.resolve(paragraphPos).nodeBefore;
        if (!before || before.type.name !== 'table') return false;

        const tableStart = paragraphPos - before.nodeSize;
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, tableStart)));
        return true;
      },

      Delete: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;

        const { $from } = selection;
        if ($from.parent.type.name !== 'paragraph') return false;
        if ($from.parent.content.size !== 0) return false;
        if ($from.parentOffset !== 0) return false;

        const paragraphEnd = $from.after($from.depth);
        const after = state.doc.resolve(paragraphEnd).nodeAfter;
        if (!after || after.type.name !== 'table') return false;

        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, paragraphEnd)));
        return true;
      },
    };
  },
});
