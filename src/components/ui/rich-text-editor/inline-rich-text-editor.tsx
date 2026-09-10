'use client';

import { useEffect, useMemo } from 'react';

import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold as BoldIcon, Redo, Undo } from 'lucide-react';

import { createInlineCellExtensions } from './inline-cell-extensions';
import { PopoverVariableMenu } from './popover-variable-menu';
import { FontColorControl } from './toolbar';
import { Sep, ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './types';

export interface InlineRichTextEditorProps {
  /** 초기 HTML. 평문뿐인 셀은 호출부가 plainTextToCellHtml 로 감싸서 넘긴다. */
  initialHtml: string;
  /**
   * 내용이 바뀔 때마다. `text` 는 문단·줄바꿈을 `\n` 으로 편 평문(정본), `html` 은 편집기가 낸
   * 그대로의 서식본이다. 마크가 없을 때 서식본을 버릴지는 호출부가 정한다.
   */
  onChange: (next: { html: string; text: string }) => void;
  variableCatalog?: VariableDef[] | undefined;
  placeholder?: string | undefined;
  /** aria-label. 모달에서 Label 과 연결할 때 쓴다. */
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

const EDITOR_CLASS =
  'min-h-[76px] px-3 py-2 text-sm text-gray-900 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none ' +
  '[&_p]:m-0 [&_p]:min-h-[1.25rem] ' +
  '[&_.mail-var-token]:rounded [&_.mail-var-token]:bg-blue-50 [&_.mail-var-token]:px-0.5 [&_.mail-var-token]:text-blue-700';

/**
 * 표 셀 본문용 축소 편집기 — 굵게·글자색·되돌리기·변수 삽입만.
 *
 * RichTextEditor(설명·공지)는 이미지·표·첨부까지 실린 완전판이라 셀 한 칸에 넣기엔 크고,
 * 셀 본문은 평문 정본(`content`)과 1:1 로 오가야 해서 문단·줄바꿈·인라인 마크 둘 외에는
 * 스키마에 아예 두지 않는다 — 붙여넣기로 들어온 다른 서식은 스키마가 떨어뜨린다.
 * 글자색 컨트롤·색 마크·변수 메뉴·토큰 강조는 완전판의 것을 그대로 쓴다.
 */
export function InlineRichTextEditor({
  initialHtml,
  onChange,
  variableCatalog,
  placeholder,
  ariaLabel,
  className,
}: InlineRichTextEditorProps) {
  const extensions = useMemo(() => createInlineCellExtensions(), []);

  const editor = useEditor({
    extensions,
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: EDITOR_CLASS,
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      onChange({
        html: editor.isEmpty ? '' : editor.getHTML(),
        text: editor.getText({ blockSeparator: '\n' }),
      });
    },
  });

  // 바깥에서 초기값이 바뀌면(모달이 다른 셀로 다시 열림) 편집기 내용을 맞춘다.
  // 우리가 낸 값이 되돌아온 경우는 같아서 건너뛰므로 커서가 튀지 않는다.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (initialHtml !== current) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  const s = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            isEmpty: editor.isEmpty,
            canUndo: editor.can().undo(),
            canRedo: editor.can().redo(),
            fontColor: (editor.getAttributes('fontColor')['color'] as string | undefined) ?? '',
          }
        : { bold: false, isEmpty: true, canUndo: false, canRedo: false, fontColor: '' },
  });

  if (!editor || !s) return null;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white transition-colors focus-within:border-blue-500 ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/50 px-2 py-1">
        <ToolBtn
          active={s.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="굵게"
        >
          <BoldIcon className="h-4 w-4" />
        </ToolBtn>
        <FontColorControl editor={editor} fontColor={s.fontColor} />
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
      </div>
      <div className="relative">
        {placeholder && s.isEmpty && (
          <span className="pointer-events-none absolute top-2 left-3 text-sm text-gray-400">
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
