'use client';

import { Editor } from '@tiptap/react';
import {
  Bold,
  Columns,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Merge,
  Paintbrush,
  Redo,
  Rows,
  Split,
  Table as TableIcon,
  Trash2,
  Underline,
  Undo,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import { PopoverVariableMenu } from './popover-variable-menu';
import type { VariableDef } from './variable-catalog';

interface Props {
  editor: Editor;
  catalog: VariableDef[];
  onPickImage: () => void;
  onPickLink: () => void;
}

export function EditorToolbar({ editor, catalog, onPickImage, onPickLink }: Props) {
  const insertVar = (key: string) => {
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  };

  const setFontSize = (px: string) => {
    // tiptap-extension-font-size 의 setFontSize chain command
    // 타입은 any 캐스트 필요할 수 있음
    (editor.chain().focus() as unknown as { setFontSize: (s: string) => { run: () => boolean } })
      .setFontSize(`${px}px`)
      .run();
  };

  const tableActive = editor.can().deleteTable();

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/50 p-2">
      <ToolBtn
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="굵게"
      >
        <Bold className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="기울임"
      >
        <Italic className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive('underline')}
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
        {[12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
          <option key={s} value={s}>
            {s}px
          </option>
        ))}
      </select>

      <Sep />

      <ToolBtn
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="글머리 기호"
      >
        <List className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="번호 매기기"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <ToolBtn onClick={onPickImage} title="이미지">
        <ImageIcon className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn onClick={onPickLink} title="링크">
        <LinkIcon className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        title="표 삽입"
      >
        <TableIcon className="h-4 w-4" />
      </ToolBtn>

      <Sep />

      <PopoverVariableMenu catalog={catalog} onPick={insertVar} />

      <div className="ml-auto flex gap-1">
        <ToolBtn
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="실행 취소"
        >
          <Undo className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="다시 실행"
        >
          <Redo className="h-4 w-4" />
        </ToolBtn>
      </div>

      {tableActive && (
        <div className="flex w-full flex-wrap gap-1 border-t border-gray-200 pt-2">
          <ToolBtn
            title="열 추가 (뒤)"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Columns className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            title="행 추가 (아래)"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <Rows className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            title="열 삭제"
            disabled={!editor.can().deleteColumn()}
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="text-red-600 hover:bg-red-50"
          >
            <Columns className="h-4 w-4" />
            <span className="text-xs">−</span>
          </ToolBtn>
          <ToolBtn
            title="행 삭제"
            disabled={!editor.can().deleteRow()}
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="text-red-600 hover:bg-red-50"
          >
            <Rows className="h-4 w-4" />
            <span className="text-xs">−</span>
          </ToolBtn>
          <ToolBtn
            title="셀 병합"
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}
          >
            <Merge className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            title="셀 분할"
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}
          >
            <Split className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            title="셀 배경"
            onClick={() =>
              editor
                .chain()
                .focus()
                .updateAttributes('tableCell', { backgroundColor: '#e5e7eb' })
                .updateAttributes('tableHeader', { backgroundColor: '#e5e7eb' })
                .run()
            }
          >
            <Paintbrush className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            title="셀 배경 제거"
            className="text-red-600 hover:bg-red-50"
            onClick={() =>
              editor
                .chain()
                .focus()
                .updateAttributes('tableCell', { backgroundColor: null })
                .updateAttributes('tableHeader', { backgroundColor: null })
                .run()
            }
          >
            <Paintbrush className="h-4 w-4" />
            <X className="h-3 w-3" />
          </ToolBtn>
          <ToolBtn
            title="표 삭제"
            className="text-red-600 hover:bg-red-50"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 className="h-4 w-4" />
          </ToolBtn>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${active ? 'bg-gray-200' : ''} ${className ?? ''}`}
    >
      {children}
    </Button>
  );
}

function Sep() {
  return <div className="h-6 w-px bg-gray-300" />;
}
