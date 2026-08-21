'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertCircle, Loader2, Paperclip, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_ATTACHMENT_FILE_BYTES } from '@/lib/mail/constants';
import { runAsyncAction } from '@/lib/run-async-action';
import { readUploadErrorMessage } from '@/lib/upload/read-upload-error-message';

interface UploadResult {
  key: string;
  url: string;
  filename: string;
  size: number;
  mime: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (result: UploadResult, label: string) => void;
}

const ACCEPT =
  'application/pdf,application/zip,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-powerpoint,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.hancom.hwp,application/x-hwp,application/hwp+zip,' +
  'application/vnd.hancom.hwpx,application/haansofthwp,application/haansofthwpx,application/hwp,' +
  'text/plain,text/csv,image/*';

export function FileAttachmentUploadModal({ open, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // 닫힐 때 상태 리셋 — effect 대신 렌더 중 조정 패턴
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setFile(null);
      setLabel('');
      setProgress(0);
      setError(null);
      setUploading(false);
    }
  }

  // 닫힐 때 진행 중인 XHR abort + 파일 input DOM 초기화 (외부 시스템 — effect 유지)
  useEffect(() => {
    if (!open) {
      xhrRef.current?.abort();
      xhrRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [open]);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      xhrRef.current = null;
    };
  }, []);

  const handleSelect = useCallback((picked: File) => {
    if (picked.size === 0) {
      setError('빈 파일은 업로드할 수 없습니다.');
      return;
    }
    if (picked.size > MAX_ATTACHMENT_FILE_BYTES) {
      setError(
        `파일 크기는 ${Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024)}MB 이하여야 합니다.`,
      );
      return;
    }
    setFile(picked);
    setError(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const picked = e.dataTransfer.files[0];
      if (picked) handleSelect(picked);
    },
    [handleSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    await runAsyncAction(
      async () => {
        const result = await new Promise<UploadResult>((resolve, reject) => {
          const onProgress = (e: ProgressEvent) => {
            if (e.lengthComputable) {
              setProgress((e.loaded / e.total) * 100);
            }
          };
          xhr.upload.addEventListener('progress', onProgress);

          xhr.addEventListener('load', () => {
            try {
              if (xhr.status === 200) {
                resolve(JSON.parse(xhr.responseText) as UploadResult);
              } else {
                reject(
                  new Error(readUploadErrorMessage(xhr.responseText, '업로드에 실패했습니다.')),
                );
              }
            } catch {
              reject(new Error('서버 응답을 처리할 수 없습니다.'));
            }
          });
          xhr.addEventListener('error', () => reject(new Error('네트워크 오류가 발생했습니다.')));
          xhr.addEventListener('abort', () => reject(new Error('업로드가 취소되었습니다.')));
          xhr.open('POST', '/api/upload/notice-attachment');
          xhr.send(fd);
        });

        xhrRef.current = null;
        onUploaded(result, label.trim());
        onClose();
      },
      {
        onError: (e) => {
          setError(e instanceof Error ? e.message : '업로드 중 오류가 발생했습니다.');
          setProgress(0);
        },
        onSettled: () => setUploading(false),
      },
    );
  }, [file, label, onClose, onUploaded]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">파일 첨부</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!file && !uploading && (
          <div
            className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition-colors hover:border-blue-400"
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) handleSelect(picked);
              }}
            />
            <Paperclip className="mx-auto mb-2 h-7 w-7 text-gray-400" aria-hidden />
            <p className="text-sm text-gray-600">파일을 드래그하거나 클릭하여 선택하세요</p>
            <p className="mt-1 text-xs text-gray-500">
              PDF / HWP / Office / ZIP / 이미지 (최대{' '}
              {Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024)}MB)
            </p>
          </div>
        )}

        {file && !uploading && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{file.name}</span>
              <span className="ml-3 text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
            <div>
              <Label className="mb-1 block text-sm" htmlFor="notice-attachment-label">
                표시 라벨 (선택 — 비워두면 파일명)
              </Label>
              <Input
                id="notice-attachment-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 협조 공문"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={handleUpload} className="flex-1">
                업로드
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setLabel('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        {uploading && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">업로드 중...</span>
              <span className="text-sm text-gray-500">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                xhrRef.current?.abort();
                xhrRef.current = null;
              }}
              className="w-full"
              disabled={progress >= 100}
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              업로드 취소
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
              {file && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleUpload}
                  className="mt-2"
                >
                  다시 시도
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
