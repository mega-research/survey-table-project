'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { createUnifiedExtensions } from './extensions';
import { ImageUploadModal } from './image-upload-modal';
import { stripTrailingEmptyParagraph } from './trailing-node';
import { Toolbar } from './toolbar';
import { useEditorImageTracker } from './use-editor-image-tracker';
import type { RichTextEditorHandle, RichTextEditorProps } from './types';

const PROSE_BASE =
  'prose prose-sm max-w-none focus:outline-none p-6 ' +
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 ' +
  '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 ' +
  '[&_li]:my-0.5 [&_li>p]:my-0 ' +
  // 테이블은 컨테이너 폭 100% 로 펼친다. NoticeRenderer 미리보기와 동일하게.
  '[&_table]:my-2 [&_table]:w-full [&_table]:table-auto [&_table]:border [&_table]:border-gray-300 ' +
  '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 [&_table_td]:h-12 ' +
  '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 [&_table_th]:h-12 ' +
  '[&_table_td_p]:m-0 [&_table_th_p]:m-0 ' +
  '[&_table_caption]:py-2 [&_table_caption]:text-sm [&_table_caption]:text-gray-700 ' +
  '[&_td.selectedCell]:relative [&_td.selectedCell]:bg-blue-100/60 ' +
  '[&_th.selectedCell]:relative [&_th.selectedCell]:bg-blue-100/60 ' +
  '[&_img]:inline-block [&_img]:!m-0 [&_img]:align-top';

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
          class: `${PROSE_BASE} ${editorClassName ?? ''}`,
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
      <div className={`flex flex-col overflow-hidden rounded-lg border border-gray-200 ${className ?? ''}`}>
        <Toolbar
          editor={editor}
          variableCatalog={variableCatalog}
          onPickImage={onPickImage}
          onPickLink={onPickLink}
        />
        <div
          className="overflow-y-auto max-h-[calc(100vh-260px)]"
          style={{ minHeight: `${minHeight}px` }}
        >
          <EditorContent editor={editor} />
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
