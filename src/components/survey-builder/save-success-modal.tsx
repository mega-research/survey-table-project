'use client';

import React, { useEffect, useRef, useState } from 'react';

import { AlertCircle, Check, Copy, Globe, Lock, Pencil, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateSlugFromTitle, getSurveyAccessUrl } from '@/lib/survey-url';
import { useSurveyBuilderStore } from '@/stores/survey-store';

interface SaveSuccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slugInput: string;
  slugError: string;
  titleInput: string;
  onSlugChange: (value: string) => void;
  onAutoGenerateSlug: () => void;
}

export const SaveSuccessModal = React.memo(function SaveSuccessModal({
  open,
  onOpenChange,
  slugInput,
  slugError,
  titleInput,
  onSlugChange,
  onAutoGenerateSlug,
}: SaveSuccessModalProps) {
  const { id, isPublic, privateToken } = useSurveyBuilderStore(
    useShallow((s) => ({
      id: s.currentSurvey.id,
      isPublic: s.currentSurvey.settings.isPublic,
      privateToken: s.currentSurvey.privateToken,
    })),
  );
  const { regeneratePrivateToken } = useSurveyBuilderStore(
    useShallow((s) => ({ regeneratePrivateToken: s.regeneratePrivateToken })),
  );

  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // 모달이 닫힐 때 내부 상태 리셋
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setIsEditingSlug(false);
      setCopySuccess(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    }
    onOpenChange(nextOpen);
  };

  // URL 복사
  const handleCopyUrl = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = getSurveyAccessUrl(
      {
        id,
        slug: slugInput || generateSlugFromTitle(titleInput),
        privateToken,
        settings: { isPublic },
      },
      baseUrl,
    );

    navigator.clipboard.writeText(url);
    setCopySuccess(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopySuccess(false), 2000);
  };

  // 비공개 토큰 재생성
  const handleRegenerateToken = () => {
    if (confirm('새로운 비공개 링크를 생성하시겠습니까? 기존 링크는 더 이상 사용할 수 없습니다.')) {
      regeneratePrivateToken();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            설문이 저장되었습니다!
          </DialogTitle>
          <DialogDescription>
            {isPublic
              ? '공개 설문 URL을 복사하여 공유하세요.'
              : '비공개 링크를 아는 사람만 설문에 접근할 수 있습니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isPublic ? (
            // 공개 설문 URL
            <>
              <div>
                <Label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-green-600" />
                  공개 설문 URL
                </Label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-sm break-all text-gray-700">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/survey/
                    <span className="font-medium text-blue-600">
                      {slugInput || generateSlugFromTitle(titleInput) || id}
                    </span>
                  </p>
                </div>
              </div>

              {/* URL 슬러그 편집 */}
              {isEditingSlug ? (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500">URL 슬러그 변경</Label>
                  <div className="flex gap-2">
                    <Input
                      value={slugInput}
                      onChange={(e) => onSlugChange(e.target.value)}
                      placeholder={generateSlugFromTitle(titleInput) || 'my-survey'}
                      className={`flex-1 ${slugError ? 'border-red-300' : ''}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onAutoGenerateSlug}
                      title="자동 생성"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  {slugError && (
                    <p className="flex items-center gap-1 text-xs text-red-500">
                      <AlertCircle className="h-3 w-3" />
                      {slugError}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  onClick={handleCopyUrl}
                  className="flex-1"
                  variant={copySuccess ? 'default' : 'outline'}
                >
                  {copySuccess ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      복사됨!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      URL 복사
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setIsEditingSlug(!isEditingSlug)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {isEditingSlug ? '완료' : 'URL 변경'}
                </Button>
              </div>
            </>
          ) : (
            // 비공개 설문 URL
            <>
              <div>
                <Label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Lock className="h-4 w-4 text-amber-600" />
                  비공개 설문 URL
                </Label>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-mono text-sm break-all text-gray-700">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/survey/
                    {privateToken || id}
                  </p>
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                  <AlertCircle className="h-3 w-3" />이 링크를 아는 사람만 설문에 접근할 수 있습니다
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleCopyUrl}
                  className="flex-1"
                  variant={copySuccess ? 'default' : 'outline'}
                >
                  {copySuccess ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      복사됨!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      URL 복사
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={handleRegenerateToken}>
                  <RefreshCw className="mr-2 h-4 w-4" />새 링크 생성
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            확인
          </Button>
          <Button onClick={() => (window.location.href = '/admin/surveys')}>설문 목록으로</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
