'use client';

import React from 'react';

import { Globe, Lock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { GroupManager } from '@/components/survey-builder/group-manager';
import { TokenWarningPanel } from '@/components/survey-builder/token-warning-panel';
import { useSurveyBuilderStore } from '@/stores/survey-store';

interface SurveySettingsPanelProps {
  slugInput: string;
  onAutoGenerateSlug: () => void;
  className?: string;
}

export const SurveySettingsPanel = React.memo(function SurveySettingsPanel({
  slugInput,
  onAutoGenerateSlug,
  className,
}: SurveySettingsPanelProps) {
  const { updateSurveySettings } = useSurveyBuilderStore(
    useShallow((s) => ({ updateSurveySettings: s.updateSurveySettings })),
  );
  const surveySettings = useSurveyBuilderStore(
    useShallow((s) => s.currentSurvey.settings),
  );
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const variableCatalog = useSurveyBuilderStore((s) => s.variableCatalog);

  return (
    <div
      className={`max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-sm ${className || ''}`}
    >
      <h3 className="mb-6 text-lg font-semibold text-gray-900">설정</h3>

      <div className="space-y-6">
        {/* 설문 설정 */}
        <div>
          <h4 className="mb-3 text-sm font-medium text-gray-700">설문 설정</h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {surveySettings.isPublic ? (
                  <Globe className="h-4 w-4 text-green-600" />
                ) : (
                  <Lock className="h-4 w-4 text-gray-500" />
                )}
                <label className="text-sm text-gray-600">공개 설문</label>
              </div>
              <input
                type="checkbox"
                checked={surveySettings.isPublic}
                onChange={(e) => {
                  updateSurveySettings({ isPublic: e.target.checked });
                  // 공개로 전환 시 자동 슬러그 생성
                  if (e.target.checked && !slugInput) {
                    onAutoGenerateSlug();
                  }
                }}
                className="rounded"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-600">진행률 표시</label>
              <input
                type="checkbox"
                checked={surveySettings.showProgressBar}
                onChange={(e) => updateSurveySettings({ showProgressBar: e.target.checked })}
                className="rounded"
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="text-sm text-gray-600">초대 링크 필수</label>
                <p className="mt-1 text-xs text-gray-400">
                  켜면 ?invite= 토큰 없이는 응답할 수 없습니다. 컨택리스트로 발송한 응답만 받고 싶을 때 사용하세요.
                </p>
              </div>
              <input
                type="checkbox"
                checked={surveySettings.requireInviteToken ?? false}
                onChange={(e) => updateSurveySettings({ requireInviteToken: e.target.checked })}
                className="mt-0.5 shrink-0 rounded"
              />
            </div>
          </div>
        </div>

        {/* 토큰 경고 */}
        {variableCatalog.length > 0 && (
          <TokenWarningPanel questions={questions} catalog={variableCatalog} />
        )}

        {/* 그룹 관리 */}
        <div className="border-t border-gray-200 pt-6">
          <GroupManager className="max-h-[400px]" />
        </div>
      </div>
    </div>
  );
});
