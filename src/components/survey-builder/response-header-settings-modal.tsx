'use client';

import { useState } from 'react';

import { PanelTop } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSurveyBuilderStore } from '@/stores/survey-store';

export function ResponseHeaderSettingsModal() {
  const [open, setOpen] = useState(false);

  const updateSurveySettings = useSurveyBuilderStore((s) => s.updateSurveySettings);
  const settings = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.settings));
  const title = useSurveyBuilderStore((s) => s.currentSurvey.title);
  const description = useSurveyBuilderStore((s) => s.currentSurvey.description);

  return (
    <>
      <Card
        className="hover-lift cursor-pointer border-gray-200 p-4 transition-all duration-200 hover:border-blue-200"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
            <PanelTop className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-gray-900">설문 헤더</h4>
            <p className="mt-1 text-xs text-gray-500">응답 페이지 머리말 설정</p>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col p-0">
          <DialogHeader className="border-b border-gray-200 px-6 py-4">
            <DialogTitle>설문 헤더</DialogTitle>
          </DialogHeader>

          {/* 미리보기: 스크롤되지 않는 고정 영역 (응답 페이지와 동일 컴포넌트) */}
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
            <SurveyResponseHeader
              title={title}
              description={description}
              responseHeader={settings.responseHeader}
            />
          </div>

          {/* 설정: 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <ResponseHeaderSettings
              settings={settings}
              onChange={(responseHeader) => updateSurveySettings({ responseHeader })}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
