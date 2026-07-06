'use client';

import { useState } from 'react';

import { PanelTop } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { SurveyResponseHeader } from '@/components/survey-response/survey-response-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { responseHeaderButtonClass } from '@/lib/survey/response-header-config';
import { cn } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';

export function ResponseHeaderSettingsModal() {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const updateSurveySettings = useSurveyBuilderStore((s) => s.updateSurveySettings);
  const updateSurveyTitle = useSurveyBuilderStore((s) => s.updateSurveyTitle);
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
        <DialogContent className="flex h-[min(92vh,60rem)] w-[min(90rem,calc(100vw-2rem))] max-w-none flex-col p-0">
          <DialogHeader className="border-b border-gray-200 px-6 py-4">
            <DialogTitle>설문 헤더</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* 좌: 미리보기 (PC/모바일 토글) */}
            <div className="min-w-0 flex-1 overflow-auto bg-gray-100 px-8 pb-9 pt-6">
              <div className="mb-4 flex justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={responseHeaderButtonClass(device === 'desktop')}
                  onClick={() => setDevice('desktop')}
                >
                  PC
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={responseHeaderButtonClass(device === 'mobile')}
                  onClick={() => setDevice('mobile')}
                >
                  모바일
                </Button>
              </div>
              {device === 'desktop' ? (
                <div
                  data-testid="header-preview-desktop"
                  className="mx-auto w-[880px] bg-white px-[52px] pb-14 pt-11 shadow-[0_4px_28px_rgba(0,0,0,0.14)]"
                >
                  <SurveyResponseHeader
                    title={title}
                    description={description}
                    responseHeader={settings.responseHeader}
                    device="desktop"
                  />
                  <PreviewSkeleton />
                </div>
              ) : (
                <div
                  data-testid="header-preview-mobile"
                  className="mx-auto w-[390px] rounded-2xl bg-white px-4 pb-8 pt-5 shadow-[0_4px_28px_rgba(0,0,0,0.14)]"
                >
                  <SurveyResponseHeader
                    title={title}
                    description={description}
                    responseHeader={settings.responseHeader}
                    device="mobile"
                  />
                  <PreviewSkeleton compact />
                </div>
              )}
            </div>

            {/* 우: 설정 사이드바 */}
            <aside className="w-[322px] flex-none overflow-y-auto border-l border-gray-200 px-4 py-5">
              <ResponseHeaderSettings
                title={title}
                onTitleChange={updateSurveyTitle}
                settings={settings}
                onChange={(responseHeader) => updateSurveySettings({ responseHeader })}
              />
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// 미리보기 하단 가짜 문항 스켈레톤 — 헤더가 실제 문맥에서 어떻게 보이는지 보여준다
function PreviewSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex flex-col opacity-55', compact ? 'mt-6 gap-4' : 'mt-9 gap-5')} aria-hidden>
      <div className="flex flex-col gap-2">
        <div className="h-3 w-3/5 rounded bg-[#dcdee3]" />
        <div className="h-2.5 w-2/5 rounded bg-[#eceef1]" />
        <div className="h-2.5 w-1/2 rounded bg-[#eceef1]" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-3 w-1/2 rounded bg-[#dcdee3]" />
        <div className={cn('w-full rounded border border-[#e4e6ea] bg-[#f2f3f5]', compact ? 'h-12' : 'h-16')} />
      </div>
    </div>
  );
}
