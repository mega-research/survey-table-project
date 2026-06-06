'use client';

import { useRouter } from 'next/navigation';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { client } from '@/shared/lib/rpc';
import type { SurveyVersionSnapshot } from '@/db/schema';

interface Props {
  surveyId: string;
  responseId: string;
  initialResponses: Record<string, unknown>;
  versionSnapshot: SurveyVersionSnapshot | null;
  initialContactAttrs: Record<string, string>;
  idx: number | null;
}

/**
 * 어드민 응답 수정 client wrapper.
 *
 * - SurveyResponseFlow 를 admin-edit 모드로 호출.
 * - onSubmit 안에서 saveAdminEdit 호출 + 응답자 목록으로 router.push.
 * - amber 헤더로 "어드민 수정 모드" 명시.
 */
export function AdminResponseEditor({
  surveyId,
  responseId,
  initialResponses,
  versionSnapshot,
  initialContactAttrs,
  idx,
}: Props) {
  const router = useRouter();

  return (
    <div>
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
        어드민 수정 모드 — 응답 {idx === null ? '' : `#${idx} `}· 응답자 흐름과 동일하게 보입니다.
      </div>
      <SurveyResponseFlow
        mode="admin-edit"
        surveyIdentifier={surveyId}
        adminContext={{
          responseId,
          surveyId,
          initialResponses,
          versionSnapshot,
          initialContactAttrs,
          onSubmit: async (payload) => {
            await client.surveyResponse.edit.saveAdminEdit({
              surveyId,
              responseId,
              questionResponses: payload.questionResponses,
            });
            router.push(`/admin/surveys/${surveyId}/operations/profiles`);
          },
        }}
      />
    </div>
  );
}
