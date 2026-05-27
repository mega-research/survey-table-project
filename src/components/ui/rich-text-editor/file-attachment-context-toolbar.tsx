'use client';

import { useEffect, useState } from 'react';

import { useEditorState, type Editor } from '@tiptap/react';
import { RefreshCw, Trash2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TMP_NOTICE_ATTACHMENT_PREFIX } from '@/lib/upload/attachment-policy';

import { ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
  onReplace: () => void;
}

const FILE_ATTACHMENT = 'fileAttachment';

async function deleteTmpKey(key: string | null) {
  if (!key) return;
  if (!key.startsWith(TMP_NOTICE_ATTACHMENT_PREFIX)) return;
  try {
    await fetch('/api/upload/notice-attachment', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  } catch {
    // best-effort — R2 lifecycle 가 24h 안에 청소함
  }
}

export function FileAttachmentContextToolbar({ editor, onReplace }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor || !editor.isActive(FILE_ATTACHMENT)) {
        return { active: false, label: '', key: null as string | null };
      }
      const attrs = editor.getAttributes(FILE_ATTACHMENT);
      return {
        active: true,
        label: (attrs.label as string) ?? '',
        key: (attrs.key as string | null) ?? null,
      };
    },
  });

  // editor 측 label 변화를 input draft 로 동기화 (다른 첨부 클릭 시 input 초기화)
  const [draft, setDraft] = useState(s.label);
  useEffect(() => {
    setDraft(s.label);
    // 노드 선택이 바뀌면 draft 도 새 값으로
  }, [s.key, s.label]);

  if (!s.active) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t border-gray-200 pt-2 mt-1">
      <Label className="text-xs font-medium text-gray-500" htmlFor="notice-attachment-label-edit">
        라벨
      </Label>
      <Input
        id="notice-attachment-label-edit"
        className="h-8 flex-1 min-w-[8rem] text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== s.label) {
            editor.chain().focus().updateAttributes(FILE_ATTACHMENT, { label: draft }).run();
          }
        }}
      />
      <ToolBtn onClick={onReplace} title="파일 교체">
        <RefreshCw className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        onClick={() => {
          const key = s.key;
          editor.chain().focus().deleteSelection().run();
          void deleteTmpKey(key);
        }}
        title="첨부 삭제"
      >
        <Trash2 className="h-4 w-4" />
      </ToolBtn>
    </div>
  );
}
