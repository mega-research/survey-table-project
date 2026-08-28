'use client';

import { useState } from 'react';

import { Loader2, TriangleAlert } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import type { UserListItem } from '@/shared/contracts/auth-io';
import type { SuccessionAssignment } from '@/shared/contracts/workspace-io';

import { FIELD_INPUT } from '../field-styles';
import { useSuccessionPreview } from './queries/use-succession';
import { useChangeUserStatus } from './queries/use-users';

interface UserDepartModalProps {
  user: UserListItem;
  onClose: () => void;
}

/** 승계 대기를 고른 상태 — 드롭다운의 예약값이다(빈 문자열은 「미선택」과 구별해야 한다). */
const PENDING = '__succession_pending__';

/**
 * 퇴사 확인 + 승계 지정 (.pen FLOW 9-3, 역할 모델 v2 티켓 19).
 *
 * **무확인 자동 이전은 하지 않는다**(스펙 §4). 시스템은 후임을 제안할 뿐이고, 처리자가
 * 설문마다 확인·변경한 뒤에만 이전된다. 그래서 이 모달은 소유 설문 전수를 펼쳐 보여주고
 * 각 행에 제안을 미리 채운다 — .pen 이 한 줄로 그린 것을 설문 수만큼 세운 모양이다
 * (제안 규칙이 설문마다 다르므로 한 줄로는 여러 건을 정직하게 표현할 수 없다).
 *
 * 후보가 없는 설문은 「승계 대기」로 고정된다. 그것도 선택이라 목록에 함께 실어 보낸다 —
 * 서버가 소유 설문 전수를 대조해 빠진 것이 있으면 거부하기 때문이다.
 */
export function UserDepartModal({ user, onClose }: UserDepartModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const preview = useSuccessionPreview(user.id);
  const { mutateAsync: changeStatus, isPending } = useChangeUserStatus();

  const surveys = preview.data?.surveys ?? [];

  /** 이 설문에 지금 지정된 후임 — 처리자가 바꿨으면 그 값, 아니면 제안(없으면 승계 대기). */
  function selectedFor(surveyId: string, proposedUserId: string | null): string {
    return overrides[surveyId] ?? proposedUserId ?? PENDING;
  }

  async function confirm() {
    setError(null);
    const succession: SuccessionAssignment[] = surveys.map((survey) => {
      const picked = selectedFor(survey.surveyId, survey.proposedUserId);
      return {
        surveyId: survey.surveyId,
        newOwnerUserId: picked === PENDING ? null : picked,
      };
    });

    try {
      await changeStatus({ action: 'depart', userId: user.id, succession });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '퇴사 처리에 실패했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[560px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold text-[#1C1C1E]">
          <TriangleAlert className="h-[18px] w-[18px] text-[#EF4444]" />
          {user.name} 님을 퇴사 처리할까요?
        </DialogTitle>
        <p className="mt-[3px] text-[12.5px] leading-relaxed text-[#6E6E73]">
          퇴사는 모든 세션을 폐기하고 팀 멤버십과 설문 소유권을 정리합니다. 되돌리려면 재입사 처리가
          필요합니다.
        </p>

        {preview.isPending && (
          <p className="mt-4 text-[12.5px] text-[#9CA3AF]">소유 설문을 확인하는 중…</p>
        )}
        {preview.isError && (
          <p className="mt-4 text-[12.5px] text-red-600">소유 설문을 확인할 수 없습니다.</p>
        )}

        {preview.isSuccess && surveys.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <span className="flex items-center gap-1.5 rounded-[9px] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              소유 설문 {surveys.length}건 — 아래 제안된 후임에게 이전됩니다
            </span>

            <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto">
              {surveys.map((survey) => (
                <div
                  key={survey.surveyId}
                  className="flex flex-col gap-1.5 rounded-[9px] border border-[#E5E5EA] px-3 py-2.5"
                >
                  <span className="truncate text-[12.5px] font-semibold text-[#1C1C1E]">
                    {survey.title}
                  </span>
                  <select
                    className={`w-full border bg-white px-2 ${FIELD_INPUT}`}
                    value={selectedFor(survey.surveyId, survey.proposedUserId)}
                    onChange={(e) => {
                      setOverrides((prev) => ({ ...prev, [survey.surveyId]: e.target.value }));
                      setError(null);
                    }}
                  >
                    {survey.candidates.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId}>
                        {candidate.name} · {candidate.teamName ?? '참여자'}
                        {candidate.userId === survey.proposedUserId
                          ? survey.proposedReason === 'participant'
                            ? ' (가장 먼저 초대됨)'
                            : ' (팀장)'
                          : ''}
                      </option>
                    ))}
                    {/* 후보가 있어도 고를 수 있다 — 「지금은 정하지 않는다」가 유효한 선택이다. */}
                    <option value={PENDING}>승계 대기로 전환</option>
                  </select>
                  {survey.proposedUserId === null && (
                    <span className="text-[11px] text-[#9CA3AF]">
                      참여자·팀장 후보가 없습니다. 재배치 센터의 설문 탭에서 새 소유자를 지정합니다.
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {preview.isSuccess && surveys.length === 0 && (
          <p className="mt-4 text-[12.5px] text-[#6E6E73]">정리할 소유 설문이 없습니다.</p>
        )}

        {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex h-[34px] items-center rounded-[9px] border border-[#E5E5EA] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirm}
            // 미리보기를 못 받은 채 확정하면 서버의 전수 대조에서 어차피 거부된다.
            disabled={isPending || !preview.isSuccess}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#B91C1C] px-4 text-[13px] font-semibold text-white hover:bg-[#991B1B] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            퇴사 처리
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
