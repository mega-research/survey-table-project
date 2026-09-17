'use client';

import { useState } from 'react';

import { CheckSquare, Loader2 } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';

import {
  DestinationTeamField,
  NewOwnerField,
  NoCandidateNotice,
  VisibilityField,
  useAssignmentFields,
} from './assignment-fields';
import { useAssignSurveys } from './queries/use-reassignment';

interface Props {
  surveyIds: string[];
  onAssigned: () => void;
}

/**
 * 일괄 배치 바 (.pen FLOW 9-2) — 선택한 설문에 **같은** 목적지·소유자·공개 범위를 적용한다.
 *
 * 「한 건이라도 실패하면 전체 취소」가 이 화면의 계약이라 부분 성공 표기가 없다. 서버가 한
 * 트랜잭션으로 처리하고 실패 사유를 그대로 돌려주므로 화면은 그 문구를 띄우고 선택을
 * 유지한다 — 지우면 사용자가 무엇을 고쳤어야 하는지 알 수 없다.
 */
export function SurveyAssignBar({ surveyIds, onAssigned }: Props) {
  const fields = useAssignmentFields();
  const [error, setError] = useState<string | null>(null);
  const assign = useAssignSurveys();

  const count = surveyIds.length;
  const canAssign = count > 0 && fields.ready && !assign.isPending;

  async function handleAssign() {
    if (!canAssign || fields.teamId === null || fields.ownerUserId === null) return;
    setError(null);
    try {
      await assign.mutateAsync({
        surveyIds,
        teamId: fields.teamId,
        ownerUserId: fields.ownerUserId,
        visibility: fields.visibility,
      });
      onAssigned();
    } catch (err) {
      setError(getErrorMessage(err, '설문을 배치하지 못했습니다.'));
    }
  }

  return (
    <div className="flex flex-col gap-[10px] rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-[14px]">
      <div className="flex flex-wrap items-end gap-3">
        <span className="flex items-center gap-[6px] self-center text-[12.5px] font-semibold text-[#2E4FCE]">
          <CheckSquare className="h-[17px] w-[17px]" />
          {count}개 선택
        </span>
        <DestinationTeamField fields={fields} width="w-[190px]" />
        <NewOwnerField fields={fields} width="w-[150px]" />
        <VisibilityField fields={fields} width="w-[130px]" />
        <div className="ml-auto">
          <button
            type="button"
            onClick={handleAssign}
            disabled={!canAssign}
            className="flex h-[38px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
          >
            {assign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}일괄 배치
          </button>
        </div>
      </div>

      <NoCandidateNotice fields={fields} />
      {count === 0 && (
        <p className="text-[11.5px] text-[#6E6E73]">
          아래 표에서 설문을 선택하면 같은 조건으로 한 번에 배치합니다.
        </p>
      )}
      {error && <p className="text-[12.5px] text-red-600">{error}</p>}
    </div>
  );
}
