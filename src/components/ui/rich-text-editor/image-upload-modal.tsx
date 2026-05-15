'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertCircle, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { optimizeImage, validateImageFile } from '@/lib/image-utils';

import type { RichTextEditorKind } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (url: string) => void;
  /** 업로드 endpoint 에 보낼 kind 값 */
  kind: RichTextEditorKind;
}

export function ImageUploadModal({ open, onClose, onUploaded, kind }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // open 변화 시 상태 리셋 (닫혔다가 다시 열릴 때 초기화)
  // 진행 중인 XHR이 있으면 함께 abort — 닫힌 모달에서 onUploaded 가 발화되는 것을 막는다
  useEffect(() => {
    if (!open) {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadProgress(0);
      setUploadError(null);
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [open]);

  // 언마운트 시 진행 중인 업로드 중단
  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  // 파일 선택 핸들러
  const handleFileSelect = useCallback(async (file: File) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || '파일 검증에 실패했습니다.');
      return;
    }

    setUploadError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // 드래그 앤 드롭 핸들러
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 업로드 취소 및 상태 초기화
  const handleCancelUpload = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadError(null);
    setUploadProgress(0);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // 패널 닫기 (업로드 취소 + onClose 호출)
  const handleClose = useCallback(() => {
    handleCancelUpload();
    onClose();
  }, [handleCancelUpload, onClose]);

  // 이미지 업로드
  const handleImageUpload = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const optimizedBlob = await optimizeImage(selectedFile);
      const optimizedFile = new File([optimizedBlob], selectedFile.name, {
        type: optimizedBlob.type || selectedFile.type,
      });

      const formData = new FormData();
      formData.append('file', optimizedFile);
      formData.append('kind', kind);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      const handleProgress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
        }
      };

      xhr.upload.addEventListener('progress', handleProgress);

      let handleLoad: () => void;
      let handleError: () => void;
      let handleAbort: () => void;

      const uploadPromise = new Promise<string>((resolve, reject) => {
        handleLoad = () => {
          // 서버가 HTML 에러 페이지 등 비-JSON 본문을 반환할 수 있으므로 parse를 보호한다
          try {
            if (xhr.status === 200) {
              const response = JSON.parse(xhr.responseText);
              resolve(response.url);
            } else {
              let message = '업로드에 실패했습니다.';
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                if (errorResponse?.error) message = errorResponse.error;
              } catch {
                // 비-JSON 응답은 기본 메시지 사용
              }
              reject(new Error(message));
            }
          } catch {
            reject(new Error('서버 응답을 처리할 수 없습니다.'));
          }
        };
        handleError = () => reject(new Error('네트워크 오류가 발생했습니다.'));
        handleAbort = () => reject(new Error('업로드가 취소되었습니다.'));

        xhr.addEventListener('load', handleLoad);
        xhr.addEventListener('error', handleError);
        xhr.addEventListener('abort', handleAbort);

        xhr.open('POST', '/api/upload/image');
        xhr.send(formData);
      }).finally(() => {
        xhr.upload.removeEventListener('progress', handleProgress);
        xhr.removeEventListener('load', handleLoad!);
        xhr.removeEventListener('error', handleError!);
        xhr.removeEventListener('abort', handleAbort!);
        xhrRef.current = null;
      });

      const imageUrl = await uploadPromise;

      // 상태 초기화 후 콜백 호출
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadProgress(0);

      onUploaded(imageUrl);
      onClose();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.';
      setUploadError(errorMessage);
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, kind, onUploaded, onClose]);

  if (!open) return null;

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      {/* 드래그 앤 드롭 영역 */}
      {!selectedFile && !isUploading && (
        <div
          className="cursor-pointer rounded-lg border-2 border-dashed border-blue-300 p-6 text-center transition-colors hover:border-blue-400"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/svg+xml,image/bmp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFileSelect(file);
              }
            }}
            className="hidden"
          />
          <Upload className="mx-auto mb-2 h-8 w-8 text-blue-500" />
          <p className="mb-2 text-sm text-gray-600">
            이미지를 드래그 앤 드롭하거나 클릭하여 선택하세요
          </p>
          <p className="mt-2 text-xs text-gray-500">
            지원 형식: JPG, PNG, GIF, WebP, SVG (최대 10MB)
          </p>
        </div>
      )}

      {/* 선택된 파일 미리보기 */}
      {selectedFile && previewUrl && !isUploading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-700">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancelUpload}
              className="text-red-600 hover:text-red-700"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="미리보기"
              className="max-h-48 w-full object-contain"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleImageUpload} className="flex-1">
              업로드
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>
              취소
            </Button>
          </div>
        </div>
      )}

      {/* 업로드 진행 중 */}
      {isUploading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">업로드 중...</span>
            <span className="text-sm text-gray-500">{Math.round(uploadProgress)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          {previewUrl && (
            <div className="overflow-hidden rounded-lg border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="업로드 중"
                className="max-h-32 w-full object-contain opacity-50"
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancelUpload}
            className="w-full"
            disabled={uploadProgress >= 100}
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            업로드 취소
          </Button>
        </div>
      )}

      {/* 에러 메시지 */}
      {uploadError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">업로드 실패</p>
            <p className="mt-1 text-sm text-red-700">{uploadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setUploadError(null);
                if (selectedFile) {
                  handleImageUpload();
                }
              }}
              className="mt-2"
            >
              다시 시도
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setUploadError(null)}
            className="text-red-600 hover:text-red-700"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
