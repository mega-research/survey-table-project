'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  Columns,
  Equal,
  Merge,
  Paintbrush,
  Rows,
  Split,
  Trash2,
  X,
} from 'lucide-react';

import { Sep, ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
}

const CELL_BG = '#e5e7eb'; // gray-200

export function TableContextToolbar({ editor }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return {
          canMerge: false,
          canSplit: false,
          canDeleteColumn: false,
          canDeleteRow: false,
        };
      }
      return {
        canMerge: editor.can().mergeCells(),
        canSplit: editor.can().splitCell(),
        canDeleteColumn: editor.can().deleteColumn(),
        canDeleteRow: editor.can().deleteRow(),
      };
    },
  });

  const setCellBg = (color: string | null) => {
    editor.chain().focus().updateAttributes('tableCell', { backgroundColor: color }).run();
    editor.chain().focus().updateAttributes('tableHeader', { backgroundColor: color }).run();
  };

  const equalizeColumnWidths = () => {
    const { state } = editor;
    const { $from } = state.selection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tableNode: any = null;
    let tablePos = -1;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'table') {
        tableNode = node;
        tablePos = $from.before(depth);
        break;
      }
    }
    if (!tableNode || tablePos < 0) return;

    let colCount = 0;
    const firstRow = tableNode.firstChild;
    if (firstRow && firstRow.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      firstRow.content.forEach((cell: any) => {
        colCount += cell.attrs.colspan || 1;
      });
    }
    if (colCount === 0) return;

    const equalWidth = Math.floor(600 / colCount);
    const { tr } = state;
    let modified = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tableNode.descendants((node: any, pos: number) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        const colspan = node.attrs.colspan || 1;
        tr.setNodeMarkup(tablePos + 1 + pos, undefined, {
          ...node.attrs,
          colwidth: Array(colspan).fill(equalWidth),
        });
        modified = true;
      }
    });
    if (modified) editor.view.dispatch(tr);
  };

  return (
    <>
      <Sep />
      <ToolBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="열 추가">
        <Columns className="h-4 w-4" />
        <span className="text-xs">+</span>
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="행 추가">
        <Rows className="h-4 w-4" />
        <span className="text-xs">+</span>
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().deleteColumn().run()}
        disabled={!s.canDeleteColumn}
        title="열 삭제"
      >
        <Columns className="h-4 w-4 text-red-600" />
        <span className="text-xs text-red-600">-</span>
      </ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().deleteRow().run()}
        disabled={!s.canDeleteRow}
        title="행 삭제"
      >
        <Rows className="h-4 w-4 text-red-600" />
        <span className="text-xs text-red-600">-</span>
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={() => editor.chain().focus().mergeCells().run()} disabled={!s.canMerge} title="셀 병합">
        <Merge className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().splitCell().run()} disabled={!s.canSplit} title="셀 분할">
        <Split className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={() => setCellBg(CELL_BG)} title="셀 배경색 적용">
        <Paintbrush className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={() => setCellBg(null)} title="셀 배경색 제거">
        <div className="relative">
          <Paintbrush className="h-4 w-4 text-red-600" />
          <X className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-red-600" />
        </div>
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={equalizeColumnWidths} title="열 너비 균등 분배">
        <Equal className="h-4 w-4" />
      </ToolBtn>
      <Sep />
      <ToolBtn
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="표 삭제"
      >
        <Trash2 className="h-4 w-4 text-red-600" />
      </ToolBtn>
    </>
  );
}
