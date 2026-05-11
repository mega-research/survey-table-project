'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertCircle, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { deleteImagesFromR2, optimizeImage, validateImageFile } from '@/lib/image-utils';

export interface CellImageEditorProps {
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
}

export function CellImageEditor({ imageUrl, onImageUrlChange }: CellImageEditorProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageUrl || null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortController = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // 언마운트 시 진행 중인 업로드 중단
  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  // 외부 imageUrl 변경 시 미리보기 동기화
  useEffect(() => {
    setPreviewUrl(imageUrl || null);
  }, [imageUrl]);

  // imageUrl이 바뀔 때 에러 상태 리셋
  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  // 파일 선택 핸들러
  const handleFileSelect = useCallback(async (file: File) => {
    // 파일 유효성 검사
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || '파일 검증에 실패했습니다.');
      return;
    }

    setUploadError(null);
    setSelectedFile(file);

    // 미리보기 생성
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

  // 이미지 업로드
  const handleImageUpload = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    uploadAbortController.current = new AbortController();

    try {
      // 이미지 최적화
      const optimizedBlob = await optimizeImage(selectedFile);
      const optimizedFile = new File([optimizedBlob], selectedFile.name, {
        type: optimizedBlob.type || selectedFile.type,
      });

      // FormData 생성
      const formData = new FormData();
      formData.append('file', optimizedFile);
      formData.append('kind', 'survey');

      // 업로드 (진행률 추적)
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      const handleProgress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
        }
      };

      xhr.upload.addEventListener('progress', handleProgress);

      // 리스너 핸들러를 Promise 밖에서 정의 (cleanup에서 접근 가능하도록)
      let handleLoad: () => void;
      let handleError: () => void;
      let handleAbort: () => void;

      const uploadPromise = new Promise<string>((resolve, reject) => {
        handleLoad = () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            resolve(response.url);
          } else {
            const errorResponse = JSON.parse(xhr.responseText);
            reject(new Error(errorResponse.error || '업로드에 실패했습니다.'));
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
        xhr.removeEventListener('load', handleLoad);
        xhr.removeEventListener('error', handleError);
        xhr.removeEventListener('abort', handleAbort);
        xhrRef.current = null;
      });

      const uploadedImageUrl = await uploadPromise;

      // 이미지 URL 설정
      onImageUrlChange(uploadedImageUrl);
      setPreviewUrl(uploadedImageUrl);

      // 상태 초기화
      setSelectedFile(null);
      setUploadProgress(0);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.';
      setUploadError(errorMessage);
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
      uploadAbortController.current = null;
    }
  }, [selectedFile, onImageUrlChange]);

  // 업로드 취소
  const handleCancelUpload = useCallback(() => {
    if (uploadAbortController.current) {
      uploadAbortController.current.abort();
    }
    setSelectedFile(null);
    if (imageUrl) {
      setPreviewUrl(imageUrl);
    } else {
      setPreviewUrl(null);
    }
    setUploadError(null);
    setUploadProgress(0);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [imageUrl]);

  // 이미지 삭제
  const handleRemoveImage = useCallback(() => {
    if (imageUrl) {
      deleteImagesFromR2([imageUrl]).catch((error) => {
        console.error('셀 이미지 삭제 실패:', error);
      });
    }
    onImageUrlChange('');
    setPreviewUrl(null);
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [imageUrl, onImageUrlChange]);

  /** 부모 모달이 열릴 때 내부 상태를 리셋할 수 있도록 노출 */
  // 부모에서 imageUrl prop 이 바뀌면 자동으로 동기화되므로 별도 reset 불필요

  return (
    <div className="space-y-4">
      {/* 드래그 앤 드롭 영역 또는 파일 선택 */}
      {!selectedFile && !isUploading && !imageUrl && (
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
          <p className="text-xs text-gray-500">
            지원 형식: JPG, PNG, GIF, WebP, SVG (최대 10MB)
          </p>
        </div>
      )}

      {/* 선택된 파일 미리보기 (업로드 전) */}
      {selectedFile && previewUrl && !isUploading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-700">
                {selectedFile.name}
              </p>
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
            <img
              key={previewUrl}
              src={previewUrl || ''}
              alt="미리보기"
              className="max-h-48 w-full object-contain"
            />
          </div>
          <Button type="button" size="sm" onClick={handleImageUpload} className="w-full">
            업로드
          </Button>
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
              <img
                key={previewUrl}
                src={previewUrl}
                alt="업로드 중"
                className="max-h-48 w-full object-contain opacity-50"
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

      {/* 업로드된 이미지 미리보기 */}
      {imageUrl && !isUploading && !selectedFile && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>업로드된 이미지</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemoveImage}
              className="text-red-600 hover:text-red-700"
            >
              <X className="mr-1 h-4 w-4" />
              삭제
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border bg-gray-50">
            <div key={imageUrl}>
              {imageError ? (
                <div className="p-3 text-center">
                  <p className="text-sm text-red-500">이미지를 불러올 수 없습니다.</p>
                </div>
              ) : (
                <img
                  src={imageUrl}
                  alt="셀 내용 이미지 미리보기"
                  className="max-h-48 w-full object-contain"
                  onError={() => setImageError(true)}
                />
              )}
            </div>
          </div>
          <div
            className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-4 text-center transition-colors hover:border-blue-400"
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
            <p className="text-sm text-gray-600">다른 이미지로 교체하기</p>
          </div>
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
