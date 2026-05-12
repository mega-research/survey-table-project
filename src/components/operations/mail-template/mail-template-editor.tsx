'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { createMailEditorExtensions } from './editor-extensions';
import { EditorToolbar } from './editor-toolbar';
import { stripTrailingEmptyParagraph } from './trailing-node';
import { useEditorImageTracker } from './use-editor-image-tracker';
import type { VariableDef } from './variable-catalog';

interface Props {
  initialHtml: string;
  catalog: VariableDef[];
  onChange: (html: string) => void;
}

export interface MailTemplateEditorHandle {
  /** 현재 에디터에 삽입됐지만 아직 저장되지 않은 이미지 URL 목록 반환 */
  getUnsavedImages: () => string[];
  /** 위 이미지들을 R2에서 일괄 삭제 */
  cleanupOrphanImages: () => Promise<void>;
}

export const MailTemplateEditor = forwardRef<MailTemplateEditorHandle, Props>(
  function MailTemplateEditor({ initialHtml, catalog, onChange }, ref) {
    const extensions = useMemo(() => createMailEditorExtensions(), []);
    const imageTracker = useEditorImageTracker(initialHtml);

    const editor = useEditor({
      extensions,
      content: initialHtml,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            'prose prose-sm max-w-none focus:outline-none min-h-[320px] p-6 ' +
            // typography 플러그인 미사용 환경에서 ul/ol 마커가 사라지므로 인라인으로 복원
            '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 ' +
            '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 ' +
            '[&_li]:my-0.5 [&_li>p]:my-0 ' +
            '[&_table]:my-2 [&_table]:border [&_table]:border-gray-300 ' +
            '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 [&_table_td]:h-12 ' +
            // td 세로 정렬이 시각적으로 보이려면 안쪽 paragraph가 셀 전체 높이를 차지하지 않아야 한다.
            '[&_table_td_p]:m-0 ' +
            '[&_table_caption]:py-2 [&_table_caption]:text-sm [&_table_caption]:text-gray-700 ' +
            // prosemirror-tables 셀 드래그 selection 시각 피드백
            '[&_td.selectedCell]:relative [&_td.selectedCell]:bg-blue-100/60 ' +
            '[&_th.selectedCell]:relative [&_th.selectedCell]:bg-blue-100/60',
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
      // 비교는 trailing paragraph를 제거한 정규화 HTML 기준
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
          if (!editor) return;
          await imageTracker.cleanupOrphans(editor.getHTML());
        },
      }),
      [editor, imageTracker],
    );

    if (!editor) return null;

    const onPickImage = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/gif,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', 'mail');
        try {
          const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
          const json = (await res.json()) as { url?: string; error?: string };
          if (!res.ok || !json.url) throw new Error(json.error ?? '이미지 업로드 실패');
          imageTracker.trackUpload(json.url);
          editor.chain().focus().setImage({ src: json.url }).run();
        } catch (err) {
          alert(err instanceof Error ? err.message : '이미지 업로드 실패');
        }
      };
      input.click();
    };

    const onPickLink = () => {
      const url = window.prompt('링크 URL');
      if (url) editor.chain().focus().setLink({ href: url }).run();
    };

    return (
      <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200">
        <EditorToolbar
          editor={editor}
          catalog={catalog}
          onPickImage={onPickImage}
          onPickLink={onPickLink}
        />
        <div className="min-h-[400px] max-h-[calc(100vh-260px)] overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  },
);
