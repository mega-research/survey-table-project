'use client';

import { useState } from 'react';

import { CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSurveyBuilderStore } from '@/stores/survey-store';

/**
 * 질문 생성 목록 맨 아래에 위치하는 "응답 완료" 트리거 카드 + 편집 다이얼로그.
 * 설문 헤더 카드(ResponseHeaderSettingsModal)와 동일한 패턴 — 카드 클릭 시 다이얼로그가
 * 열리고, 응답 완료 화면에 표시되는 종료 멘트만 편집한다. 저장을 누르기 전까지는 초안만
 * 갱신하고, 취소·X·ESC·바깥 클릭 시 조용히 폐기한다.
 */
export function CompletionMessageModal() {
  const [open, setOpen] = useState(false);

  const thankYouMessage = useSurveyBuilderStore((s) => s.currentSurvey.settings.thankYouMessage);
  const updateSurveySettings = useSurveyBuilderStore((s) => s.updateSurveySettings);

  const [draftMessage, setDraftMessage] = useState(thankYouMessage);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // 열릴 때마다 최신 store 기준으로 재시드 — 이전 초안(취소로 폐기된 편집분 포함)은 버린다
      setDraftMessage(thankYouMessage);
    }
    setOpen(next);
  };

  const handleSave = () => {
    updateSurveySettings({ thankYouMessage: draftMessage });
    setOpen(false);
  };

  return (
    <>
      <Card
        className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
        onClick={() => handleOpenChange(true)}
      >
        <div className="flex items-start space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
            <CheckCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-gray-900">응답 완료</h4>
            <p className="mt-1 text-xs text-gray-500">응답 완료 화면 멘트 설정</p>
          </div>
        </div>
      </Card>

      {/* onOpenChange(false)는 X·ESC·바깥 클릭 포함 — 확인창 없이 조용히 초안을 폐기한다 */}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>응답 완료 멘트</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="completion-message">종료 멘트</Label>
            <Textarea
              id="completion-message"
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              placeholder="응답해주셔서 감사합니다!"
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-gray-400">
              응답을 마친 참여자에게 보여지는 완료 화면의 문구입니다.
            </p>
          </div>

          {/* 저장/취소 게이트 — X·ESC·바깥 클릭은 위 onOpenChange(false)가 담당(조용히 폐기) */}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="button" onClick={handleSave}>
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
