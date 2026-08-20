'use client';

import { useState } from 'react';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paperclip,
  Redo,
  Strikethrough,
  Underline,
  Undo,
  X,
} from 'lucide-react';

import { findTableAtSelection } from '@/lib/tiptap/find-table';
import { normalizeCellHexColor } from '@/utils/cell-style';

import { FileAttachmentContextToolbar } from './file-attachment-context-toolbar';
import { FONT_FAMILIES, FONT_GROUPS } from './font-family-mark';
import { ImageContextToolbar } from './image-context-toolbar';
import { PopoverVariableMenu } from './popover-variable-menu';
import { TableContextToolbar } from './table-context-toolbar';
import { TableInsertMenu } from './table-insert-menu';
import { Sep, ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './types';

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32] as const;

interface Props {
  editor: Editor;
  variableCatalog?: VariableDef[];
  onPickImage: () => void;
  onPickLink: () => void;
  onPickFile?: () => void;
  onReplaceFile?: () => void;
  enableImageLinkArea?: boolean;
}

/**
 * 글자 색 컨트롤 — 셀 배경색 UI(CellStyleFields) 패턴 재활용:
 * 색상 스포이드 + HEX 직접 입력(blur/Enter 커밋, normalizeCellHexColor 정규화) + 제거 버튼.
 */
function FontColorControl({ editor, fontColor }: { editor: Editor; fontColor: string }) {
  const [draft, setDraft] = useState(fontColor);

  // 커서 이동 등으로 현재 선택의 색이 바뀌면 입력칸도 동기화 (렌더 중 상태 조정 패턴)
  const [lastFontColor, setLastFontColor] = useState(fontColor);
  if (fontColor !== lastFontColor) {
    setLastFontColor(fontColor);
    setDraft(fontColor);
  }

  const commitDraft = () => {
    if (draft.trim() === '') {
      editor.chain().focus().unsetFontColor().run();
      return;
    }
    const normalized = normalizeCellHexColor(draft);
    if (normalized) {
      setDraft(normalized);
      editor.chain().focus().setFontColor(normalized).run();
      return;
    }
    // 잘못된 값은 현재 색으로 되돌린다
    setDraft(fontColor);
  };

  return (
    <>
      <label
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5"
        title="글자 색"
      >
        <Baseline className="h-4 w-4 text-gray-600" />
        <input
          type="color"
          value={fontColor || '#000000'}
          onChange={(e) => {
            const color = e.target.value.toUpperCase();
            setDraft(color);
            editor.chain().focus().setFontColor(color).run();
          }}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          aria-label="글자 색 선택"
        />
      </label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          }
        }}
        placeholder="#AABBCC"
        className="h-8 w-[76px] rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        aria-label="글자 색 HEX"
      />
      <ToolBtn onClick={() => editor.chain().focus().unsetFontColor().run()} title="글자 색 제거">
        <div className="relative">
          <Baseline className="h-4 w-4 text-red-600" />
          <X className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-red-600" />
        </div>
      </ToolBtn>
    </>
  );
}

export function Toolbar({ editor, variableCatalog, onPickImage, onPickLink, onPickFile, onReplaceFile, enableImageLinkArea }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) {
        return {
          bold: false, italic: false, underline: false, strike: false,
          bulletList: false, orderedList: false,
          alignLeft: true, alignCenter: false, alignRight: false, alignJustify: false,
          canUndo: false, canRedo: false,
          imageActive: false, tableActive: false, fileAttachmentActive: false,
          fontFamily: '', fontColor: '',
        };
      }
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
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
        fileAttachmentActive: editor.isActive('fileAttachment'),
        fontFamily: (editor.getAttributes('fontFamily')['family'] as string | undefined) ?? '',
        fontColor: (editor.getAttributes('fontColor')['color'] as string | undefined) ?? '',
      };
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50/50 px-2 py-1.5">
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
        className="h-8 max-w-[110px] rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        value={s.fontFamily}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        aria-label="폰트"
      >
        <option value="">기본 폰트</option>
        {FONT_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {FONT_FAMILIES.filter((f) => f.group === group).map((f) => (
              <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs"
        onChange={(e) => editor.chain().focus().setFontSize(`${e.target.value}px`).run()}
        defaultValue="14"
        aria-label="폰트 크기"
      >
        {FONT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}px</option>)}
      </select>

      <FontColorControl editor={editor} fontColor={s.fontColor} />

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
      {onPickFile && (
        <ToolBtn onClick={onPickFile} title="파일 첨부">
          <Paperclip className="h-4 w-4" />
        </ToolBtn>
      )}
      <TableInsertMenu editor={editor} />

      {variableCatalog && variableCatalog.length > 0 && (
        <>
          <Sep />
          <PopoverVariableMenu
            catalog={variableCatalog}
            onPick={(key) => {
              const token = `{{${key}}}`;
              // invite_link 는 클릭 가능한 a 태그로 감싸야 메일 클라이언트가 확실히 링크로 렌더한다.
              // href·텍스트 양쪽 모두 발송 시 sample.inviteUrl 로 치환됨 (render-preview.ts).
              if (key === 'invite_link') {
                editor
                  .chain()
                  .focus()
                  .insertContent([
                    {
                      type: 'text',
                      text: token,
                      marks: [{ type: 'link', attrs: { href: token } }],
                    },
                  ])
                  .run();
                return;
              }
              editor.chain().focus().insertContent(token).run();
            }}
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

      {s.imageActive && (
        <ImageContextToolbar
          editor={editor}
          enableImageLinkArea={enableImageLinkArea ?? false}
          variableCatalog={variableCatalog ?? []}
        />
      )}
      {s.tableActive && <TableContextToolbar editor={editor} />}
      {s.fileAttachmentActive && onReplaceFile && (
        <FileAttachmentContextToolbar editor={editor} onReplace={onReplaceFile} />
      )}
    </div>
  );
}
