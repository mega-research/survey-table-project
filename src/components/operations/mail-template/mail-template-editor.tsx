'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { extractImageUrlsFromHtml } from '@/lib/image-extractor';
import { deleteImagesFromR2 } from '@/lib/image-utils';

import { createMailEditorExtensions } from './editor-extensions';
import { EditorToolbar } from './editor-toolbar';
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
  const [, force] = useState({});

  // 이미지 cleanup 추적
  const uploadedImageUrlsRef = useRef<Set<string>>(new Set());
  const previousContentRef = useRef<string>(initialHtml || '');

  const editor = useEditor({
    extensions,
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[320px] p-6 ' +
          '[&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-gray-300 ' +
          '[&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-2 [&_table_td]:py-1 ' +
          '[&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:px-2 [&_table_th]:py-1 ' +
          '[&_table_th]:bg-gray-50',
      },
    },
    onUpdate: ({ editor }) => {
      force({});
      const currentHtml = editor.getHTML();

      // 이미지 삭제 감지 및 R2 cleanup
      const previousImages = extractImageUrlsFromHtml(previousContentRef.current);
      const currentImages = extractImageUrlsFromHtml(currentHtml);
      const deletedImages = previousImages.filter(
        (url) => !currentImages.includes(url) && uploadedImageUrlsRef.current.has(url),
      );

      if (deletedImages.length > 0) {
        deleteImagesFromR2(deletedImages).catch((error) => {
          console.error('이미지 삭제 실패:', error);
        });
        deletedImages.forEach((url) => uploadedImageUrlsRef.current.delete(url));
      }

      previousContentRef.current = currentHtml;
      onChange(editor.isEmpty ? '' : currentHtml);
    },
    onSelectionUpdate: () => {
      force({});
    },
    onTransaction: () => {
      // mark 토글 등 셀렉션이 안 바뀌는 변경도 툴바 active 동기화
      force({});
    },
  });

  // 초기 마운트 시 기존 이미지 추적 (편집 모드에서 기존 이미지도 추적 대상에 포함)
  useEffect(() => {
    if (initialHtml) {
      const initialImages = extractImageUrlsFromHtml(initialHtml);
      initialImages.forEach((url) => uploadedImageUrlsRef.current.add(url));
      previousContentRef.current = initialHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 초기 마운트 시에만 실행

  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  // 부모 컴포넌트에서 orphan 이미지 cleanup을 호출할 수 있도록 imperative handle 노출
  useImperativeHandle(ref, () => ({
    getUnsavedImages: () => {
      if (!editor) return [];
      const currentImages = extractImageUrlsFromHtml(editor.getHTML());
      return Array.from(uploadedImageUrlsRef.current).filter(
        (url) => !currentImages.includes(url),
      );
    },
    cleanupOrphanImages: async () => {
      if (!editor) return;
      const currentImages = extractImageUrlsFromHtml(editor.getHTML());
      const orphans = Array.from(uploadedImageUrlsRef.current).filter(
        (url) => !currentImages.includes(url),
      );
      if (orphans.length > 0) {
        await deleteImagesFromR2(orphans).catch((error) => {
          console.error('orphan 이미지 삭제 실패:', error);
        });
        orphans.forEach((url) => uploadedImageUrlsRef.current.delete(url));
      }
    },
  }), [editor]);

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
      try {
        const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
        const json = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !json.url) throw new Error(json.error ?? '이미지 업로드 실패');
        // 업로드된 URL 추적
        uploadedImageUrlsRef.current.add(json.url);
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
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <EditorToolbar
        editor={editor}
        catalog={catalog}
        onPickImage={onPickImage}
        onPickLink={onPickLink}
      />
      <EditorContent editor={editor} />
    </div>
  );
});

