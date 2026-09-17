'use client';

import { useEffect, useEffectEvent, useMemo } from 'react';

import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold as BoldIcon, Redo, Underline as UnderlineIcon, Undo } from 'lucide-react';

import { TITLE_DEFAULT_FONT_SIZE, TITLE_FONT_SIZES } from '@/lib/survey/question-title-html';

import { createInlineCellExtensions, createInlineTitleExtensions } from './inline-cell-extensions';
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
  /**
   * 'cell'(기본) = 셀 본문 — 굵게·글자색, 여러 줄.
   * 'title' = 문항 제목 — 굵게·밑줄·글자색·글자 크기, 한 줄(Enter 를 막고 평문은 공백으로 편다).
   */
  variant?: 'cell' | 'title' | undefined;
}

const EDITOR_CLASS =
  'min-h-[76px] px-3 py-2 text-sm text-gray-900 whitespace-pre-wrap [overflow-wrap:anywhere] outline-none ' +
  '[&_p]:m-0 [&_p]:min-h-[1.25rem] ' +
  '[&_.mail-var-token]:rounded [&_.mail-var-token]:bg-blue-50 [&_.mail-var-token]:px-0.5 [&_.mail-var-token]:text-blue-700';

/** 제목 모드 — 한 줄 높이, 응답 화면 제목과 비슷한 글자 크기. */
const TITLE_EDITOR_CLASS =
  'min-h-[40px] px-3 py-2 text-base text-gray-900 [overflow-wrap:anywhere] outline-none ' +
  '[&_p]:m-0 ' +
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
  variant = 'cell',
}: InlineRichTextEditorProps) {
  const isTitle = variant === 'title';
  const extensions = useMemo(
    () => (isTitle ? createInlineTitleExtensions() : createInlineCellExtensions()),
    [isTitle],
  );
  // placeholder 표시 여부는 prop 에서 바로 편다 — 호출부가 onChange 값을 되돌려 주므로
  // initialHtml 이 곧 현재 내용이다. 편집기 상태 셀렉터의 첫 값(비어 있음)에 기대면
  // 초기 내용이 있는데도 placeholder 가 글 위에 겹친다.
  const isEmpty = initialHtml === '';

  const editor = useEditor({
    extensions,
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: isTitle ? TITLE_EDITOR_CLASS : EDITOR_CLASS,
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      onChange({
        html: editor.isEmpty ? '' : editor.getHTML(),
        // 제목은 한 줄 — 붙여넣기로 문단이 여럿 들어와도 평문은 공백으로 잇는다.
        text: editor.getText({ blockSeparator: isTitle ? ' ' : '\n' }),
      });
    },
  });

  // 바깥에서 초기값이 바뀌면(모달이 다른 셀로 다시 열림) 편집기 내용을 맞춘다.
  // 우리가 낸 값이 되돌아온 경우는 같아서 건너뛰므로 커서가 튀지 않는다.
  // editor 는 effect event 로 최신 참조를 읽는다 — 트리거는 initialHtml 하나로 둔다
  // (옆 파일 rich-text-editor.tsx 와 같은 관례. disable 주석은 컴파일러 skip 을 부른다).
  const syncContentFromProp = useEffectEvent(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (initialHtml !== current) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
  });
  useEffect(() => {
    syncContentFromProp();
  }, [initialHtml]);

  const s = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            underline: isTitle && editor.isActive('underline'),
            fontSize: isTitle
              ? ((editor.getAttributes('fontSize')['size'] as string | undefined) ?? '')
              : '',
            canUndo: editor.can().undo(),
            canRedo: editor.can().redo(),
            fontColor: (editor.getAttributes('fontColor')['color'] as string | undefined) ?? '',
          }
        : {
            bold: false,
            underline: false,
            fontSize: '',
            canUndo: false,
            canRedo: false,
            fontColor: '',
          },
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
        {isTitle && (
          <>
            <ToolBtn
              active={s.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="밑줄"
            >
              <UnderlineIcon className="h-4 w-4" />
            </ToolBtn>
            <select
              className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
              value={s.fontSize}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') editor.chain().focus().unsetFontSize().run();
                else editor.chain().focus().setFontSize(v).run();
              }}
              aria-label="글자 크기"
              title="글자 크기"
            >
              <option value="">{TITLE_DEFAULT_FONT_SIZE}px (기본)</option>
              {TITLE_FONT_SIZES.filter((sz) => sz !== TITLE_DEFAULT_FONT_SIZE).map((sz) => (
                <option key={sz} value={`${sz}px`}>
                  {sz}px
                </option>
              ))}
            </select>
          </>
        )}
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
        {placeholder && isEmpty && (
          <span
            className={`pointer-events-none absolute left-3 text-gray-400 ${
              isTitle ? 'top-2 text-base' : 'top-2 text-sm'
            }`}
          >
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
