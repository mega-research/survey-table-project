'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo,
  Underline,
  Undo,
} from 'lucide-react';

import { findTableAtSelection } from '@/lib/tiptap/find-table';

import { PopoverVariableMenu } from './popover-variable-menu';
import { TableContextToolbar } from './table-context-toolbar';
import { TableInsertMenu } from './table-insert-menu';
import { Sep, ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './variable-catalog';

interface Props {
  editor: Editor;
  catalog: VariableDef[];
  onPickImage: () => void;
  onPickLink: () => void;
}

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32] as const;

export function EditorToolbar({ editor, catalog, onPickImage, onPickLink }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return {
          bold: false,
          italic: false,
          underline: false,
          bulletList: false,
          orderedList: false,
          alignLeft: true,
          alignCenter: false,
          alignRight: false,
          alignJustify: false,
          canUndo: false,
          canRedo: false,
          tableActive: false,
        };
      }
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        alignLeft: editor.isActive({ textAlign: 'left' }),
        alignCenter: editor.isActive({ textAlign: 'center' }),
        alignRight: editor.isActive({ textAlign: 'right' }),
        alignJustify: editor.isActive({ textAlign: 'justify' }),
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        tableActive: findTableAtSelection(editor.state) !== null,
      };
    },
  });

  const insertVar = (key: string) => {
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  };

  const setFontSize = (px: string) => {
    editor.chain().focus().setFontSize(`${px}px`).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/50 p-2">
      <ToolBtn
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="굵게"
      >
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="기울임"
      >
        <Italic className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="밑줄"
      >
        <Underline className="h-4 w-4" />
      </ToolBtn>

      <select
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        onChange={(e) => setFontSize(e.target.value)}
        defaultValue="14"
        aria-label="폰트 크기"
      >
        {FONT_SIZES.map((sz) => (
          <option key={sz} value={sz}>
            {sz}px
          </option>
        ))}
      </select>

      <Sep />

      <ToolBtn
        active={s.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="글머리 기호"
      >
        <List className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="번호 매기기"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn
        active={s.alignLeft}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        title="왼쪽 정렬"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.alignCenter}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        title="가운데 정렬"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.alignRight}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        title="오른쪽 정렬"
      >
        <AlignRight className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={s.alignJustify}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        title="양쪽 정렬"
      >
        <AlignJustify className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn onClick={onPickImage} title="이미지">
        <ImageIcon className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onPickLink} title="링크">
        <LinkIcon className="h-4 w-4" />
      </ToolBtn>

      <TableInsertMenu editor={editor} />

      <Sep />

      <PopoverVariableMenu catalog={catalog} onPick={insertVar} />

      <div className="ml-auto flex gap-1">
        <ToolBtn
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!s.canUndo}
          title="실행 취소"
        >
          <Undo className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!s.canRedo}
          title="다시 실행"
        >
          <Redo className="h-4 w-4" />
        </ToolBtn>
      </div>

      {s.tableActive && <TableContextToolbar editor={editor} />}
    </div>
  );
}
