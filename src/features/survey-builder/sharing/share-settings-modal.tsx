'use client';

import { useState } from 'react';

import { ArrowRightLeft, Loader2, Lock, Users } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import {
  SURVEY_VISIBILITY_LABEL,
  type SurveyVisibility,
  surveyVisibilityValues,
} from '@/shared/contracts/workspace';

import { useSetSurveyVisibility } from '../queries/use-survey-sharing';
import { FieldworkBlock } from './fieldwork-block';
import { GuestsBlock } from './guests-block';
import { OwnershipTransferModal } from './ownership-transfer-modal';
import { ParticipantsBlock } from './participants-block';

interface ShareSettingsModalProps {
  surveyId: string;
  surveyTitle: string;
  visibility: SurveyVisibility;
  /**
   * 공개 범위를 바꿀 수 있는가 — 서버의 `survey.manageAccess` **근사치**
   * (canManageSurveyAccessCard). 강제는 서버 관문이 한다.
   */
  canManageAccess: boolean;
  /** 「현재 소유자」 표기 (.pen 4-4 부제). 소유자를 모르는 옛 설문은 null 이다. */
  currentOwnerName: string | null;
  /** 이전 요청이 되돌려 보낼 낙관적 동시성 토큰. */
  currentOwnerUserId: string | null;
  onClose: () => void;
}

/**
 * 세그먼트 두 칸 (.pen 4-2). 라벨은 어휘 SSOT 를 그대로 쓴다 — 재배치 센터가 같은 컬럼을
 * 다른 말로 적어 두 화면이 어긋났던 자리다(SURVEY_VISIBILITY_LABEL 주석).
 */
const VISIBILITY_ICON: Record<SurveyVisibility, typeof Users> = {
  team: Users,
  invite_only: Lock,
};

/**
 * 공유 설정 모달 (.pen FLOW 4-2, 역할 모델 v2 티켓 16).
 *
 * **왜 workspace 가 아니라 여기 사는가** — PRD 파일 맵은 공유 모달을 `features/workspace` 로
 * 적었지만 그 배치는 실현 불가능하다. 입구가 설문 카드 케밥(.pen 4-1)인데 survey-builder 는
 * workspace 를 import 할 수 없고(ESLint 방향: builder → response → renderer) 반대도 마찬가지라,
 * workspace 에 두면 카드가 이 모달을 열 방법이 없다. 설문 그룹 UI 가 같은 이유로
 * `survey-list/groups` 에 사는 선례다 — 서버 도메인이 workspace 인 것과 화면이 어디 사는가는
 * 별개다. 티켓 18·21·24 의 참여자·게스트·실사 검색도 **RPC 로** workspace 표면을 부르므로
 * (`client.workspace.*`, 그룹 쿼리와 같은 경로) feature import 는 필요 없다.
 *
 * 네 블록이 모두 섰다(.pen 4-2) — 공개 범위 + 참여자 + 클라이언트(게스트) + 실사, 그리고
 * 푸터의 「소유권 이전」. 뒤 세 블록은 「저장」에 묶이지 않고 즉시 반영된다: 사람을 붙이고
 * 떼는 일은 폼이 아니라 동작이고, 모달을 닫는 것으로 되돌릴 수 있다고 말하면 거짓이 된다.
 *
 * 「소유권 이전」은 **공개 범위 변경과 같은 권한 축이지만 다른 표면**이다. 되돌리는 동선이
 * 없고 발행·삭제 권한이 함께 움직여서 확인 단계를 따로 둔다 — 저장 버튼에 묶으면 범위만
 * 바꾸려던 사람이 소유자까지 넘긴다.
 *
 * 모달을 **여는 것**은 권한으로 막지 않는다. 접근 가능한 내부인이면 누구나 참여자를 추가할
 * 수 있는 것이 스펙 §7 이고, 잠기는 것은 범위 세그먼트뿐이다. 그래서 팀원에게는 지금 상태가
 * 읽기 전용으로 보인다.
 *
 * 저장은 **닫기와 한 몸**이다 — 세그먼트를 누르는 즉시 저장하면 「취소」가 아무 뜻도 없게 되고,
 * 되돌리려면 다시 눌러야 하는데 그 사이 목록·그룹 카운트가 두 번 흔들린다.
 */
export function ShareSettingsModal({
  surveyId,
  surveyTitle,
  visibility,
  canManageAccess,
  currentOwnerName,
  currentOwnerUserId,
  onClose,
}: ShareSettingsModalProps) {
  const [selected, setSelected] = useState<SurveyVisibility>(visibility);
  const [transferOpen, setTransferOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setVisibility = useSetSurveyVisibility();

  const isDirty = selected !== visibility;

  async function handleSave() {
    if (!isDirty) {
      onClose();
      return;
    }
    setError(null);
    try {
      await setVisibility.mutateAsync({ surveyId, visibility: selected });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '공개 범위를 저장하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-[560px] gap-0 overflow-y-auto rounded-2xl p-[22px]">
        <DialogTitle className="truncate text-[16.5px] font-semibold text-[#1C1C1E]">
          공유 설정 — {surveyTitle}
        </DialogTitle>

        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-[#374151]">팀 공개 범위</span>

          <div
            role="radiogroup"
            aria-label="공개 범위"
            className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]"
          >
            {surveyVisibilityValues.map((value) => {
              const Icon = VISIBILITY_ICON[value];
              const active = selected === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!canManageAccess || setVisibility.isPending}
                  onClick={() => {
                    setSelected(value);
                    setError(null);
                  }}
                  className={cn(
                    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-colors',
                    active ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#6E6E73]',
                    canManageAccess && !active && 'hover:text-[#1C1C1E]',
                    !canManageAccess && 'cursor-not-allowed',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {SURVEY_VISIBILITY_LABEL[value]}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
            「초대된 멤버만」은 소유 팀 팀원에게만 숨깁니다 — 소유자·참여자·팀장·슈퍼어드민은 항상
            접근합니다.
          </p>
          {!canManageAccess && (
            <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
              공개 범위는 소유자·팀장·슈퍼어드민만 바꿀 수 있습니다.
            </p>
          )}
        </div>

        {/* 참여자 블록은 자기 mutation 을 즉시 반영한다 — 공개 범위의 「저장」과 축이 다르다.
            들이고 빼는 일은 되돌릴 확인이 필요 없고, 한 모달의 저장 버튼에 묶으면 검색·추가
            도중 취소를 누른 사람이 초대까지 되돌아간 줄로 읽는다. */}
        <div className="mt-4 border-t border-[#F0F0F2] pt-4">
          <ParticipantsBlock surveyId={surveyId} />
        </div>

        {/* 클라이언트 블록도 같은 축이다 — 부여·탭 저장이 즉시 반영되고 「저장」에 묶이지 않는다. */}
        <div className="mt-4 border-t border-[#F0F0F2] pt-4">
          <GuestsBlock surveyId={surveyId} />
        </div>

        {/* 실사 블록 — 네 번째이자 마지막 블록(.pen 4-2). 초대는 개인 단위이고 즉시 반영이다. */}
        <div className="mt-4 border-t border-[#F0F0F2] pt-4">
          <FieldworkBlock surveyId={surveyId} />
        </div>

        {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-[#F0F0F2] pt-3.5">
          {/* 이전 권한은 공개 범위와 같은 열(소유자·팀장·슈퍼어드민)이라 같은 값으로 잠근다. */}
          {canManageAccess ? (
            <button
              type="button"
              onClick={() => setTransferOpen(true)}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#2E4FCE] hover:underline"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              소유권 이전
            </button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={setVisibility.isPending}
              className="flex h-[34px] items-center rounded-[9px] border border-[#E5E5EA] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canManageAccess || setVisibility.isPending}
              className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
            >
              {setVisibility.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              저장
            </button>
          </div>
        </div>
      </DialogContent>

      {transferOpen && (
        <OwnershipTransferModal
          surveyId={surveyId}
          surveyTitle={surveyTitle}
          currentOwnerName={currentOwnerName}
          currentOwnerUserId={currentOwnerUserId}
          onClose={() => setTransferOpen(false)}
        />
      )}
    </Dialog>
  );
}
