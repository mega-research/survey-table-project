'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { createUnifiedExtensions } from './extensions';
import { ImageUploadModal } from './image-upload-modal';
import { stripTrailingEmptyParagraph } from './trailing-node';
import { Toolbar } from './toolbar';
import { useEditorImageTracker } from './use-editor-image-tracker';
import type { RichTextEditorHandle, RichTextEditorProps } from './types';

// 공통 룰: 표 정렬 Decoration·이미지 정렬·셀 선택 강조 등 편집 전용 시각 — 미리보기와 무관.
// 표 폭은 셀 콘텐츠에 맞춰 자동. prose 기본 width 100% 를 !w-auto 로 override —
// 표 정렬(TableAlignDecoration) 이 wrapper flex 로 동작하려면 table 폭이 wrapper 보다
// 작아야 시각 효과가 보인다.
const COMMON_EDITOR_BASE =
  'max-w-none focus:outline-none p-6 flex-1 ' +
  '[&_table]:!w-auto [&_table]:table-auto ' +
  '[&_table_td_p]:m-0 [&_table_th_p]:m-0 ' +
  '[&_td.selectedCell]:relative [&_td.selectedCell]:bg-blue-100/60 ' +
  '[&_th.selectedCell]:relative [&_th.selectedCell]:bg-blue-100/60 ' +
  '[&_img]:inline-block [&_img]:!m-0 [&_img]:align-top';

// 설문 빌더: 기존 prose 적용 유지.
const SURVEY_BASE =
  `prose prose-sm ${COMMON_EDITOR_BASE} ` +
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 ' +
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 ' +
  '[&_li]:my-0.5 [&_li>p]:my-0 ' +
  '[&_table]:my-2 [&_table]:border [&_table]:border-gray-300 ' +
  '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 [&_table_td]:h-12 ' +
  '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 [&_table_th]:h-12';

// 메일: prose 제거 + 미리보기 iframe CSS(preview-dialog.tsx IFRAME_RESET_CSS) 와 동일한
// font-size·line-height·color 와 p/ul/ol/li/table/td 마진·패딩을 직접 부여해 편집 시각이
// 미리보기와 일치하도록 한다. 표 정렬·이미지 정렬·셀 선택 강조 등 편집 전용 룰은 COMMON_EDITOR_BASE 가 담당.
const MAIL_BASE =
  `${COMMON_EDITOR_BASE} ` +
  'text-[14px] leading-[1.5] text-gray-800 ' +
  // .ProseMirror p 의 gap: 8px(globals.css) 가 이미지·텍스트 사이에 자동 공백을 만들어
  // 미리보기와 달라 보인다. paragraph 의 flex container 자체는 유지해야 (이미지 wrapper 의
  // float style 을 flex item 으로 무력화) 표가 이미지 옆으로 흐르는 것을 막을 수 있으므로,
  // display 는 건드리지 않고 gap 만 0 으로 강제.
  '[&_p]:!gap-0 [&_p]:mt-0 [&_p]:mb-[0.5em] [&_p:last-child]:mb-0 ' +
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-[0.5em] ' +
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-[0.5em] ' +
  '[&_li]:my-[0.2em] [&_li>p]:my-0 ' +
  '[&_table]:my-[0.5em] [&_table]:border-collapse [&_table]:border [&_table]:border-gray-300 ' +
  '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 ' +
  '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 ' +
  '[&_a]:text-blue-600 [&_a]:underline';

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      initialHtml,
      onChange,
      kind = 'survey',
      variableCatalog,
      imageUploadMode = kind === 'mail' ? 'simple' : 'modal',
      className,
      editorClassName,
      minHeight = 320,
      placeholder,
    },
    ref,
  ) {
    const extensions = useMemo(() => createUnifiedExtensions({ kind }), [kind]);
    const imageTracker = useEditorImageTracker(initialHtml);
    const [showModal, setShowModal] = useState(false);

    const editor = useEditor({
      extensions,
      content: initialHtml,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: `${kind === 'mail' ? MAIL_BASE : SURVEY_BASE} ${editorClassName ?? ''}`,
          ...(placeholder ? { 'data-placeholder': placeholder } : {}),
        },
      },
      onUpdate: ({ editor }) => {
        const currentHtml = stripTrailingEmptyParagraph(editor.getHTML());
        imageTracker.reconcileAfterUpdate(currentHtml);
        onChange(editor.isEmpty ? '' : currentHtml);
      },
    });

    useEffect(() => {
      if (!editor) return;
      const currentNormalized = stripTrailingEmptyParagraph(editor.getHTML());
      if (initialHtml !== currentNormalized) {
        editor.commands.setContent(initialHtml, { emitUpdate: false });
        imageTracker.resetPrevious(initialHtml);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialHtml]);

    useImperativeHandle(
      ref,
      () => ({
        getUnsavedImages: () => (editor ? imageTracker.getOrphans(editor.getHTML()) : []),
        cleanupOrphanImages: async () => {
          if (editor) await imageTracker.cleanupOrphans(editor.getHTML());
        },
        insertImage: (url: string) => {
          if (!editor) return;
          imageTracker.trackUpload(url);
          editor.chain().focus().setImage({ src: url }).run();
        },
        getEditor: () => editor,
      }),
      [editor, imageTracker],
    );

    if (!editor) return null;

    const onPickImage = () => {
      if (imageUploadMode === 'modal') {
        setShowModal(true);
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/gif,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', kind);
        try {
          const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
          const json = (await res.json()) as { url?: string; error?: string };
          if (!res.ok || !json.url) throw new Error(json.error ?? '이미지 업로드 실패');
          // 업로드 도중 호스트가 언마운트되어 editor 가 destroy 됐을 수 있다
          if (editor.isDestroyed) return;
          imageTracker.trackUpload(json.url);
          editor.chain().focus().setImage({ src: json.url }).run();
        } catch (err) {
          if (!editor.isDestroyed) {
            alert(err instanceof Error ? err.message : '이미지 업로드 실패');
          }
        }
      };
      input.click();
    };

    const onPickLink = () => {
      const url = window.prompt('링크 URL');
      if (url) editor.chain().focus().setLink({ href: url }).run();
    };

    return (
      <div
        className={`flex flex-col overflow-hidden rounded-lg border border-gray-200 transition-colors focus-within:border-blue-500 ${className ?? ''}`}
      >
        <Toolbar
          editor={editor}
          variableCatalog={variableCatalog}
          onPickImage={onPickImage}
          onPickLink={onPickLink}
        />
        <div
          className="flex flex-col overflow-y-auto max-h-[calc(100vh-260px)]"
          style={{ minHeight: `${minHeight}px` }}
        >
          <EditorContent editor={editor} className="flex flex-1 flex-col" />
        </div>
        <ImageUploadModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onUploaded={(url) => {
            setShowModal(false);
            imageTracker.trackUpload(url);
            editor.chain().focus().setImage({ src: url }).run();
          }}
          kind={kind}
        />
      </div>
    );
  },
);
