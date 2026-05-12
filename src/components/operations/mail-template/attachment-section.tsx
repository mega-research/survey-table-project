'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Paperclip, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { MailAttachment } from '@/db/schema/schema-types';
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from '@/lib/mail/constants';
import {
  deleteMailAttachmentTmp,
  uploadMailAttachment,
} from '@/lib/mail/mail-attachment-client';

interface Props {
  attachments: MailAttachment[];
  /** functional updater — stale closure race 차단. */
  onChange: (updater: (prev: MailAttachment[]) => MailAttachment[]) => void;
  /** 업로드 in-flight 상태를 부모로 노출 — 저장/발송 버튼 차단용. */
  onUploadingChange?: (isUploading: boolean) => void;
}

interface InFlight {
  tempId: string;
  filename: string;
  size: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 같은 파일명+사이즈가 이미 있으면 중복으로 판정 — 사용자 실수 패턴 차단. */
function findDuplicate(
  existing: MailAttachment[],
  inFlight: InFlight[],
  file: File,
): string | null {
  if (existing.some((a) => a.filename === file.name && a.size === file.size)) {
    return existing.find((a) => a.filename === file.name)!.filename;
  }
  if (inFlight.some((f) => f.filename === file.name && f.size === file.size)) {
    return file.name;
  }
  return null;
}

export function AttachmentSection({ attachments, onChange, onUploadingChange }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<InFlight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // unmount 후 setState 호출 차단. in-flight 업로드가 응답 받기 전에 dialog 닫히는 케이스.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 최신 attachments 를 ref 로 추적 — 동기 read 가 필요한 사전 검증용 (race 무관).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // 업로드 상태 변화를 부모로 전파 — 부모가 저장/발송 버튼 차단 결정에 사용.
  useEffect(() => {
    onUploadingChange?.(uploading.length > 0);
  }, [uploading.length, onUploadingChange]);

  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  const overSoftLimit = totalSize > MAX_ATTACHMENT_TOTAL_BYTES * 0.85;
  const overHardLimit = totalSize > MAX_ATTACHMENT_TOTAL_BYTES;

  const handleFiles = async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files);
    if (list.length === 0) {
      // 폴더 드롭 등 — File 객체가 빈 list 로 들어옴.
      setError('파일만 첨부할 수 있습니다. 폴더는 지원하지 않습니다.');
      return;
    }

    // 동일 파일명+사이즈 중복 사전 차단.
    const dups: string[] = [];
    const fresh: File[] = [];
    for (const f of list) {
      const dup = findDuplicate(attachmentsRef.current, uploading, f);
      if (dup) dups.push(dup);
      else fresh.push(f);
    }
    if (dups.length > 0) {
      setError(`이미 같은 파일이 첨부되어 있습니다: ${dups.join(', ')}`);
      if (fresh.length === 0) return;
    }

    // 총합 한도 사전 검사 — ref 로 최신값 read.
    const currentSize = attachmentsRef.current.reduce((s, a) => s + a.size, 0);
    const incomingSize = fresh.reduce((s, f) => s + f.size, 0);
    if (currentSize + incomingSize > MAX_ATTACHMENT_TOTAL_BYTES) {
      setError(
        `총합 한도(${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}) 를 초과합니다. 현재 ${formatBytes(currentSize)} + 추가 ${formatBytes(incomingSize)}.`,
      );
      return;
    }

    const flights: InFlight[] = fresh.map((f) => ({
      tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: f.name,
      size: f.size,
    }));
    setUploading((u) => [...u, ...flights]);

    const results = await Promise.all(fresh.map(uploadMailAttachment));

    if (!mountedRef.current) return;

    const added: MailAttachment[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.ok) added.push(r.attachment);
      else errors.push(r.error);
    }

    setUploading((u) => u.filter((f) => !flights.some((nf) => nf.tempId === f.tempId)));
    if (added.length > 0) {
      // functional updater — props.attachments stale closure 와 무관하게 항상 최신 base 위에 append.
      onChange((prev) => [...prev, ...added]);
    }
    if (errors.length > 0) {
      setError((prev) => (prev ? `${prev}\n${errors.join('\n')}` : errors.join('\n')));
    }
  };

  const handleRemove = (att: MailAttachment) => {
    onChange((prev) => prev.filter((a) => a.key !== att.key));
    // tmp 만 즉시 R2 삭제 — 영구 위치는 저장 시 orchestrator 가 처리.
    void deleteMailAttachmentTmp(att.key);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    } else {
      setError('파일만 첨부할 수 있습니다. 폴더는 지원하지 않습니다.');
    }
  };

  const hasItems = attachments.length > 0 || uploading.length > 0;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-gray-900">첨부파일</Label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
        }`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col items-center gap-2 text-sm text-gray-600">
          <Upload className="h-5 w-5 text-gray-400" />
          <div>
            파일을 여기로 끌어다 놓거나{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-blue-600"
              onClick={() => inputRef.current?.click()}
            >
              찾아보기
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            파일당 {formatBytes(MAX_ATTACHMENT_FILE_BYTES)}, 총합 {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} 까지
          </p>
        </div>
      </div>

      {hasItems && (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {attachments.map((a) => (
            <li
              key={a.key}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate text-gray-900">{a.filename}</span>
                <span className="shrink-0 text-xs text-gray-500">
                  · {formatBytes(a.size)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-500 hover:text-red-600"
                onClick={() => handleRemove(a)}
                aria-label={`${a.filename} 삭제`}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {uploading.map((f) => (
            <li
              key={f.tempId}
              className="flex items-center gap-3 px-3 py-2 text-sm text-gray-500"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-gray-300" />
              <span className="truncate">{f.filename}</span>
              <span className="shrink-0 text-xs">
                · {formatBytes(f.size)} · 업로드 중...
              </span>
            </li>
          ))}
        </ul>
      )}

      <div
        className={`flex justify-between text-xs ${
          overHardLimit
            ? 'text-red-600'
            : overSoftLimit
              ? 'text-amber-600'
              : 'text-gray-500'
        }`}
      >
        <span>
          총합 {formatBytes(totalSize)} / {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}
        </span>
        {overHardLimit && <span>한도를 초과했습니다 — 일부 파일을 제거해 주세요.</span>}
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
