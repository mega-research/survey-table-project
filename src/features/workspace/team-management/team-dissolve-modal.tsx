'use client';

import { useState } from 'react';

import { FileText, Globe, Loader2, TriangleAlert, Users } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import type { TeamListItem } from '@/shared/contracts/workspace-io';

import { FIELD_INPUT } from '../field-styles';
import { useDissolveTeam } from './queries/use-teams';

interface Props {
  team: TeamListItem;
  onClose: () => void;
  /** 해산이 확정된 뒤 — 호출측이 작업 범위·캐시 정리를 이어서 한다. */
  onDissolved: (team: TeamListItem) => void;
}

/**
 * 팀 해산 확인 (.pen FLOW 8-1) — 되돌릴 수 없는 일이라 이름을 다시 받는다.
 *
 * 그룹 삭제(FLOW 2-3)에는 이름 입력이 없는데 여기에는 있는 이유는 되돌릴 수 있느냐다.
 * 그룹은 삭제해도 설문이 미분류로 남고 다시 만들면 그만이지만, 해산은 팀원 전원을 미배치로,
 * 설문 전부를 배치 대기로 내려보내고 복구 경로가 재배치 센터(티켓 14)뿐이다.
 *
 * 영향 요약 세 줄은 **바뀌는 것 둘과 바뀌지 않는 것 하나**다. 세 번째 줄이 중요하다 —
 * 해산이 응답자·게스트·발송 중 메일에 아무 영향을 주지 않는다는 사실을 확정 직전에 말해주지
 * 않으면, 조사가 도는 팀은 아무도 해산 버튼을 누르지 못한다.
 *
 * 숫자는 목록 카드가 이미 들고 있는 값을 그대로 쓴다(별도 조회 없음). 확정 시점에 실제로
 * 몇 건이 움직였는지는 서버가 트랜잭션 안에서 재서 감사 행에 남긴다 — 화면의 숫자는 판단을
 * 돕는 근사이고, 기록으로 남는 것은 그쪽이다.
 */
export function TeamDissolveModal({ team, onClose, onDissolved }: Props) {
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dissolveTeam = useDissolveTeam();

  // 정확히 같아야 한다. 공백 차이로 통과시키면 확인란이 장식이 된다 — 서버도 같은 대조를 한다.
  const canDissolve = confirmName === team.name;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canDissolve) return;
    setError(null);
    try {
      await dissolveTeam.mutateAsync({ teamId: team.id, confirmName });
      onDissolved(team);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '팀을 해산하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[500px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="flex items-center gap-2.5 text-[17px] font-semibold text-[#1C1C1E]">
          <TriangleAlert className="h-5 w-5 shrink-0 text-[#EF4444]" />
          {team.name}을 해산할까요?
        </DialogTitle>
        <p className="mt-3.5 text-[13px] text-[#6E6E73]">
          이 작업은 되돌릴 수 없습니다. 해산을 확정하면 즉시 적용됩니다.
        </p>

        <div className="mt-3.5 flex flex-col gap-[9px] rounded-[10px] bg-[#F9FAFB] p-3.5">
          <ImpactRow icon={<Users className="h-3.5 w-3.5 shrink-0 text-[#374151]" />}>
            팀원 {team.memberCount}명이 미배치로 전환됩니다 · 로그인과 프로필만 가능
          </ImpactRow>
          <ImpactRow icon={<FileText className="h-3.5 w-3.5 shrink-0 text-[#374151]" />}>
            설문 {team.surveyCount}개가 배치 대기로 이동합니다 · 재배치 센터에서 승계
          </ImpactRow>
          <ImpactRow icon={<Globe className="h-3.5 w-3.5 shrink-0 text-[#374151]" />}>
            외부 응답 · 게스트 열람 · 메일 발송은 계속 동작합니다
          </ImpactRow>
        </div>

        <form onSubmit={handleSubmit} className="mt-3.5 flex flex-col gap-2">
          <label htmlFor="dissolve-confirm" className="text-[12px] text-[#9CA3AF]">
            확인을 위해 팀 이름을 입력하세요
          </label>
          <input
            id="dissolve-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={team.name}
            autoComplete="off"
            autoFocus
            className={FIELD_INPUT}
          />

          {error && <p className="text-[12.5px] text-red-600">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#E5E5EA] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canDissolve || dissolveTeam.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#EF4444] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#DC2626] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
            >
              {dissolveTeam.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}팀 해산
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImpactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-[#374151]">
      {icon}
      {children}
    </span>
  );
}
