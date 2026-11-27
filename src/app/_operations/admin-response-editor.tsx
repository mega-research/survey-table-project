'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { operationsPaths } from '@/utils/operations-paths';
import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { client } from '@/shared/lib/rpc';
import type { SurveyDocumentView } from '@/shared/contracts/survey-builder-io';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';

interface Props {
  surveyId: string;
  /** 이 콘솔의 주소 접두 — 저장 뒤 돌아갈 응답 내역이 이 아래에 있다. */
  basePath: string;
  responseId: string;
  initialResponses: Record<string, unknown>;
  versionSnapshot: SurveyVersionSnapshot | null;
  initialContactAttrs: Record<string, string>;
  /** 이 응답자의 이월 응답 한 벌. 익명 응답·이월 미보유면 null. 이월 표시(빨강) 전용. */
  initialPriorAnswers: Record<string, unknown> | null;
  /** 렌더 버전 스냅샷의 얼린 앵커 + 현재 조사표 파일 (RSC 가 만들어 넘긴다). */
  documentView: SurveyDocumentView | null;
  idx: number | null;
  renderedVersionId: string | null;
  migratedFromOldVersion: boolean;
  /** 조회 전용(응답 조회 화면) — 값을 바꿀 수 없고 저장을 부르지 않는다. */
  readOnly?: boolean;
  /** 조회를 닫으면 갈 주소 — 없으면 `basePath` 의 응답 내역. */
  closeHref?: string;
}

/**
 * 어드민 응답 수정 client wrapper.
 *
 * - SurveyResponseFlow 를 admin-edit 모드로 호출.
 * - onSubmit 안에서 saveAdminEdit 호출 + 응답자 목록으로 router.push.
 * - 내부 콘솔과 외주 실사 링크 트리가 함께 쓴다(ADR-0027) — 돌아갈 주소만 `basePath` 로 갈린다.
 * - amber 헤더로 "어드민 수정 모드" 명시.
 * - `readOnly` 면 응답 조회 화면이다 — 같은 흐름을 잠가 그리고(값 쓰기·검증·저장 없음) 마지막 쪽은
 *   「닫기」로 응답 내역에 돌아간다(`closeHref`). 이 모드로 여는 라우트는 클라이언트 링크의 응답 조회
 *   (「응답 조회」 칩)다 — 운영(main)의 보기 전용 고객 계정 응답 조회와 같은 본문.
 */
export function AdminResponseEditor({
  surveyId,
  basePath,
  responseId,
  initialResponses,
  versionSnapshot,
  initialContactAttrs,
  initialPriorAnswers,
  documentView,
  idx,
  renderedVersionId,
  migratedFromOldVersion,
  readOnly = false,
  closeHref,
}: Props) {
  const router = useRouter();
  const profilesHref = closeHref ?? operationsPaths(basePath).profiles;

  return (
    <div>
      {readOnly ? (
        <div
          role="status"
          className="border-b border-slate-200 bg-slate-50 px-6 py-3 text-sm text-slate-700"
        >
          응답 조회 — 응답 {idx === null ? '' : `#${idx} `}· 응답자가 본 화면 그대로 보입니다. 값은 바꿀
          수 없고, 「다음」으로 쪽을 넘겨 가며 봅니다.
        </div>
      ) : (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
          어드민 수정 모드 — 응답 {idx === null ? '' : `#${idx} `}· 응답자 흐름과 동일하게 보입니다.
          중간에 나가면 저장되지 않으며, 마지막 제출까지 끝내야 수정이 반영됩니다.
        </div>
      )}
      {migratedFromOldVersion &&
        (readOnly ? (
          <div className="border-b border-blue-200 bg-blue-50 px-6 py-3 text-sm text-blue-900">
            응답한 뒤에 설문이 바뀌었습니다. 지금 설문 모양으로 보여 주며, 구조가 달라진 문항의 답은
            비어 보일 수 있습니다.
          </div>
        ) : (
          <div className="border-b border-blue-200 bg-blue-50 px-6 py-3 text-sm text-blue-900">
            구버전 형식으로 작성된 응답입니다. 최신 형식(테스트 응답은 저장한 내용)으로 수정 중이며, 구조가
            달라진 답변은 비워져 있습니다. 저장하면 이 응답은 최신 버전으로 이관됩니다.
          </div>
        ))}
      <SurveyResponseFlow
        mode="admin-edit"
        surveyIdentifier={surveyId}
        adminContext={{
          responseId,
          surveyId,
          initialResponses,
          versionSnapshot,
          initialContactAttrs,
          initialPriorAnswers,
          documentView,
          // 구버전 응답이면 숨은 문항 strip 을 걸지 않는다 (서버 migrating 게이트와 동일 판정).
          migratedFromOldVersion,
          ...(readOnly
            ? { readOnlyView: { closeLabel: '닫기', onClose: () => router.push(profilesHref) } }
            : {}),
          onSubmit: async (payload) => {
            // 조회 전용은 흐름이 제출을 부르지 않는다 — 불려도 저장하지 않는다.
            if (readOnly) return;
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
            router.push(profilesHref);
          },
        }}
      />
    </div>
  );
}
