'use client';

import { useState } from 'react';

import { ArrowRightLeft, Info, Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';

import { useTransferCandidates, useTransferSurveyOwnership } from '../queries/use-survey-ownership';

interface OwnershipTransferModalProps {
  surveyId: string;
  surveyTitle: string;
  /** 지금 소유자 이름 — 「현재 소유자: 김연구」 부제 (.pen 4-4). null 이면 생략한다. */
  currentOwnerName: string | null;
  onClose: () => void;
}

/** 영향 요약 (.pen 4-4) — 이전이 무엇을 바꾸고 무엇을 그대로 두는지 세 줄로 말한다. */
const IMPACTS = [
  '발행·삭제·공유 관리 권한이 새 소유자에게 넘어갑니다',
  '문의·메일 회신은 다음 발송부터 새 소유자 이메일로 연동됩니다',
  '기존 참여자·클라이언트(게스트)·실사 부여는 유지됩니다',
];

/**
 * 소유권 이전 모달 (.pen FLOW 4-4, 역할 모델 v2 티켓 19).
 *
 * 공유 설정 모달의 「소유권 이전」이 연다. 실행 권한은 소유자·팀장·슈퍼어드민
 * (`survey.transferOwnership`)이고 후보는 **같은 팀 active 멤버 + 이 설문 참여자**다 —
 * 그 목록을 서버가 만든다(화면이 모집단을 다시 정의하면 서버 판정과 갈린다).
 *
 * 영향 요약을 접지 않고 항상 펼쳐 두는 것이 .pen 의 선택이다. 이전은 되돌리는 표면이
 * 따로 없고(다시 이전할 뿐) 발행·삭제 권한이 함께 움직이므로, 누르기 전에 읽히는 편이 낫다.
 */
export function OwnershipTransferModal({
  surveyId,
  surveyTitle,
  currentOwnerName,
  onClose,
}: OwnershipTransferModalProps) {
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const candidates = useTransferCandidates(surveyId);
  const transfer = useTransferSurveyOwnership();

  const options = candidates.data ?? [];

  async function handleTransfer() {
    if (!selected) return;
    setError(null);
    try {
      await transfer.mutateAsync({ surveyId, newOwnerUserId: selected });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '소유권을 이전하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[460px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">소유권 이전</DialogTitle>
        <p className="mt-[3px] truncate text-[12.5px] text-[#6E6E73]">
          {surveyTitle}
          {currentOwnerName ? ` · 현재 소유자: ${currentOwnerName}` : ''}
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-[#374151]">새 소유자</span>
          <select
            aria-label="새 소유자"
            value={selected}
            disabled={candidates.isPending || options.length === 0}
            onChange={(e) => {
              setSelected(e.target.value);
              setError(null);
            }}
            className="h-9 w-full rounded-lg border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#1C1C1E] focus:outline-none disabled:bg-[#F5F5F7]"
          >
            <option value="">
              {candidates.isPending
                ? '후보를 불러오는 중…'
                : options.length === 0
                  ? '이전할 수 있는 사람이 없습니다'
                  : '선택하세요'}
            </option>
            {options.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name} · {candidate.teamName ?? '참여자'}
              </option>
            ))}
          </select>
          <span className="text-[10.5px] text-[#9CA3AF]">
            같은 팀 active 멤버 또는 이 설문 참여자에게 이전할 수 있습니다.
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-[9px] bg-[#F5F5F7] px-3.5 py-3">
          {IMPACTS.map((impact) => (
            <span key={impact} className="flex items-start gap-2 text-[12px] text-[#374151]">
              <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#6E6E73]" />
              {impact}
            </span>
          ))}
        </div>

        {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={transfer.isPending}
            className="flex h-[34px] items-center rounded-[9px] border border-[#E5E5EA] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!selected || transfer.isPending}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
          >
            {transfer.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-3.5 w-3.5" />
            )}
            소유권 이전
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
