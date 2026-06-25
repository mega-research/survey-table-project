'use client';

import { useState } from 'react';

import { useEditorState, type Editor } from '@tiptap/react';
import { RefreshCw, Trash2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { deleteTmpNoticeAttachmentKey } from './file-attachment-r2-client';
import { ToolBtn } from './toolbar-primitives';

interface Props {
  editor: Editor;
  onReplace: () => void;
}

const FILE_ATTACHMENT = 'fileAttachment';

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
        label: (attrs['label'] as string) ?? '',
        key: (attrs['key'] as string | null) ?? null,
      };
    },
  });

  if (!s.active) return null;

  return (
    <FileAttachmentContextToolbarContent
      key={s.key ?? 'inactive'}
      editor={editor}
      fileKey={s.key}
      label={s.label}
      onReplace={onReplace}
    />
  );
}

function FileAttachmentContextToolbarContent({
  editor,
  fileKey,
  label,
  onReplace,
}: {
  editor: Editor;
  fileKey: string | null;
  label: string;
  onReplace: () => void;
}) {
  // editor 측 label 변화를 input draft 로 동기화 (다른 첨부 클릭 시 input 초기화)
  const [draft, setDraft] = useState(label);

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
          if (draft !== label) {
            editor.chain().focus().updateAttributes(FILE_ATTACHMENT, { label: draft }).run();
          }
        }}
      />
      <ToolBtn onClick={onReplace} title="파일 교체">
        <RefreshCw className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn
        onClick={() => {
          editor.chain().focus().deleteSelection().run();
          void deleteTmpNoticeAttachmentKey(fileKey);
        }}
        title="첨부 삭제"
      >
        <Trash2 className="h-4 w-4" />
      </ToolBtn>
    </div>
  );
}
