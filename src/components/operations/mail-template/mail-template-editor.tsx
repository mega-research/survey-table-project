'use client';

import { useEffect, useMemo, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';

import { createMailEditorExtensions } from './editor-extensions';
import { EditorToolbar } from './editor-toolbar';
import type { VariableDef } from './variable-catalog';

interface Props {
  initialHtml: string;
  catalog: VariableDef[];
  onChange: (html: string) => void;
}

export function MailTemplateEditor({ initialHtml, catalog, onChange }: Props) {
  const extensions = useMemo(() => createMailEditorExtensions(), []);
  const [, force] = useState({});

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
      onChange(editor.isEmpty ? '' : editor.getHTML());
    },
    onSelectionUpdate: () => {
      force({});
    },
    onTransaction: () => {
      // mark 토글 등 셀렉션이 안 바뀌는 변경도 툴바 active 동기화
      force({});
    },
  });

  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

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
}
