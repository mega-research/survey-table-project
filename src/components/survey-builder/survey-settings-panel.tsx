'use client';

import React from 'react';

import { Globe, Lock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { GroupManager } from '@/components/survey-builder/group-manager';
import { TokenWarningPanel } from '@/components/survey-builder/token-warning-panel';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';

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
  const { updateSurveySettings, updateContactEmail } = useSurveyBuilderStore(
    useShallow((s) => ({
      updateSurveySettings: s.updateSurveySettings,
      updateContactEmail: s.updateContactEmail,
    })),
  );
  const surveySettings = useSurveyBuilderStore(
    useShallow((s) => s.currentSurvey.settings),
  );
  const contactEmail = useSurveyBuilderStore(
    useShallow((s) => s.currentSurvey.contactEmail),
  );
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const variableCatalog = useSurveyUIStore((s) => s.variableCatalog);

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
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-600">초대 링크 필수</label>
              <input
                type="checkbox"
                checked={surveySettings.requireInviteToken ?? false}
                onChange={(e) => updateSurveySettings({ requireInviteToken: e.target.checked })}
                className="rounded"
              />
            </div>
            {/* 켜면 응답 페이지 컨테이너를 표 유무와 무관하게 항상 넓게(max-w-7xl),
                끄면 표 총폭 기준 자동 판정 (기본) */}
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-600">화면 너비</label>
              <input
                type="checkbox"
                checked={surveySettings.forceWideLayout ?? false}
                onChange={(e) => updateSurveySettings({ forceWideLayout: e.target.checked })}
                className="rounded"
              />
            </div>
          </div>
        </div>

        {/* 문의 이메일 */}
        <div className="space-y-2">
          <label htmlFor="contact-email" className="text-sm font-medium text-gray-700">
            응답자 문의 이메일
          </label>
          <input
            id="contact-email"
            type="email"
            value={contactEmail ?? ''}
            onChange={(e) => updateContactEmail(e.target.value || null)}
            placeholder="admin@example.com"
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            중복 응답 차단 화면에 표시되는 문의 이메일 주소입니다. 비워두면 메시지만 표시됩니다.
          </p>
        </div>

        {/* 개인정보 보관기한 */}
        <div className="space-y-2">
          <label htmlFor="pii-retention" className="text-sm font-medium text-gray-700">
            개인정보 보관기한
          </label>
          <input
            id="pii-retention"
            type="date"
            value={surveySettings.piiRetentionUntil ?? ''}
            onChange={(e) =>
              updateSurveySettings({ piiRetentionUntil: e.target.value || null })
            }
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
          />
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
