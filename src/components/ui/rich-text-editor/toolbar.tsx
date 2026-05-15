'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo,
} from 'lucide-react';

import { findTableAtSelection } from '@/lib/tiptap/find-table';

import { ImageContextToolbar } from './image-context-toolbar';
import { PopoverVariableMenu } from './popover-variable-menu';
import { TableContextToolbar } from './table-context-toolbar';
import { Sep, ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './types';

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32] as const;

interface Props {
  editor: Editor;
  variableCatalog?: VariableDef[];
  onPickImage: () => void;
  onPickLink: () => void;
}

export function Toolbar({ editor, variableCatalog, onPickImage, onPickLink }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return {
          bold: false, italic: false, underline: false, strike: false,
          h1: false, h2: false, h3: false,
          bulletList: false, orderedList: false,
          alignLeft: true, alignCenter: false, alignRight: false, alignJustify: false,
          canUndo: false, canRedo: false,
          imageActive: false, tableActive: false,
        };
      }
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        h1: editor.isActive('heading', { level: 1 }),
        h2: editor.isActive('heading', { level: 2 }),
        h3: editor.isActive('heading', { level: 3 }),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        alignLeft: editor.isActive({ textAlign: 'left' }),
        alignCenter: editor.isActive({ textAlign: 'center' }),
        alignRight: editor.isActive({ textAlign: 'right' }),
        alignJustify: editor.isActive({ textAlign: 'justify' }),
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        // ImageResize NodeView 는 schema 에 imageResize 이름으로 등록된다
        imageActive: editor.isActive('imageResize'),
        tableActive: findTableAtSelection(editor.state) !== null,
      };
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/50 p-2">
      <ToolBtn active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게">
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임">
        <Italic className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄">
        <Underline className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선">
        <Strikethrough className="h-4 w-4" />
      </ToolBtn>

      <select
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
        onChange={(e) => (editor.chain().focus() as any).setFontSize(`${e.target.value}px`).run()}
        defaultValue="14"
        aria-label="폰트 크기"
      >
        {FONT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}px</option>)}
      </select>

      <Sep />

      <ToolBtn active={s.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="제목1">
        <Heading1 className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="제목2">
        <Heading2 className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="제목3">
        <Heading3 className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn active={s.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()} title="글머리 기호">
        <List className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 매기기">
        <ListOrdered className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn active={s.alignLeft} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="왼쪽 정렬">
        <AlignLeft className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.alignCenter} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="가운데 정렬">
        <AlignCenter className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.alignRight} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="오른쪽 정렬">
        <AlignRight className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn active={s.alignJustify} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="양쪽 정렬">
        <AlignJustify className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn onClick={onPickImage} title="이미지"><ImageIcon className="h-4 w-4" /></ToolBtn>
      <ToolBtn onClick={onPickLink} title="링크"><LinkIcon className="h-4 w-4" /></ToolBtn>
      <ToolBtn
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="표 삽입"
      >
        <TableIcon className="h-4 w-4" />
      </ToolBtn>

      {variableCatalog && variableCatalog.length > 0 && (
        <>
          <Sep />
          <PopoverVariableMenu
            catalog={variableCatalog}
            onPick={(key) => editor.chain().focus().insertContent(`{{${key}}}`).run()}
          />
        </>
      )}

      <div className="ml-auto flex gap-1">
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!s.canUndo} title="실행 취소">
          <Undo className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!s.canRedo} title="다시 실행">
          <Redo className="h-4 w-4" />
        </ToolBtn>
      </div>

      {s.imageActive && <ImageContextToolbar editor={editor} />}
      {s.tableActive && <TableContextToolbar editor={editor} />}
    </div>
  );
}
