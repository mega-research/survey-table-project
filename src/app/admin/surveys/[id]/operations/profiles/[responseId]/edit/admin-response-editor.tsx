'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
  renderedVersionId: string | null;
  migratedFromOldVersion: boolean;
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
  renderedVersionId,
  migratedFromOldVersion,
}: Props) {
  const router = useRouter();

  return (
    <div>
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
        어드민 수정 모드 — 응답 {idx === null ? '' : `#${idx} `}· 응답자 흐름과 동일하게 보입니다.
        중간에 나가면 저장되지 않으며, 마지막 제출까지 끝내야 수정이 반영됩니다.
      </div>
      {migratedFromOldVersion && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-3 text-sm text-blue-900">
          구버전 형식으로 작성된 응답입니다. 최신 배포 형식으로 수정 중이며, 구조가 달라진
          답변은 비워져 있습니다. 저장하면 이 응답은 최신 버전으로 이관됩니다.
        </div>
      )}
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
            try {
              await client.surveyResponse.edit.saveAdminEdit({
                surveyId,
                responseId,
                questionResponses: payload.questionResponses,
                versionId: renderedVersionId,
              });
            } catch (err) {
              // 저장 중 새 버전 배포(CONFLICT) 등 — 서버 메시지를 그대로 노출하고
              // 제출 상태 복구를 위해 rethrow (flow 가 isSubmitting 을 되돌린다).
              toast.error(err instanceof Error ? err.message : '저장에 실패했습니다.');
              throw err;
            }
            router.push(`/admin/surveys/${surveyId}/operations/profiles`);
          },
        }}
      />
    </div>
  );
}
