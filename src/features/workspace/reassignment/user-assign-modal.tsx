'use client';

import { useState } from 'react';

import { Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getErrorMessage } from '@/lib/get-error-message';
import type { TeamRole } from '@/shared/contracts/workspace';
import type { UnassignedUserItem } from '@/shared/contracts/workspace-io';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useTeams } from '../team-management/queries/use-teams';

import { formatPreviousTeam } from './reassignment-vocabulary';
import { useAssignUserToTeam } from './queries/use-reassignment';

const ROLE_LABEL: Record<TeamRole, string> = { member: '팀원', leader: '팀장' };

const SELECT_TRIGGER = 'h-9 rounded-lg border-[#D1D5DB] text-[13px]';

interface Props {
  user: UnassignedUserItem;
  onClose: () => void;
}

/**
 * 팀 배정 모달 (.pen FLOW 8-3) — 미배치 사용자에게 목적지 팀·역할·직책을 지정한다.
 *
 * 팀 상세의 「팀원 추가」와 대칭이지만 방향이 반대다: 저쪽은 팀장이 자기 팀으로 사람을
 * 검색해 당기고(pull), 이쪽은 슈퍼어드민이 사람을 정해두고 목적지를 고른다(push). 그래서
 * 여기에는 검색이 없고 대신 직책 칸이 있다 — 해산으로 소속을 잃은 사람의 직책을 새 팀
 * 기준으로 다시 적는 자리다.
 *
 * 셋을 한 번에 확정하는 것이 계약이다. 팀만 넣고 직책을 따로 고치면 「팀은 들어갔는데 직책은
 * 옛 팀 것」인 절반 상태가 남고, 그 상태를 화면이 구분해 보여줄 방법이 없다.
 */
export function UserAssignModal({ user, onClose }: Props) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [role, setRole] = useState<TeamRole>('member');
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [error, setError] = useState<string | null>(null);

  const teams = useTeams();
  const assign = useAssignUserToTeam();
  const canAssign = teamId !== null && !assign.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canAssign || teamId === null) return;
    setError(null);
    try {
      await assign.mutateAsync({ userId: user.userId, teamId, role, jobTitle: jobTitle.trim() });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '팀에 배정하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[460px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">팀 배정</DialogTitle>
        <DialogDescription className="mt-1.5 text-[12.5px] text-[#6E6E73]">
          {user.name} · 이전 {formatPreviousTeam(user.previousTeamName)}
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-[14px]">
          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="assign-team" className={FIELD_LABEL}>
              목적지 팀
            </Label>
            {/* 미선택은 빈 문자열로 계속 제어한다 — assignment-fields 의 같은 주석 참조. */}
            <Select value={teamId ?? ''} onValueChange={setTeamId}>
              <SelectTrigger id="assign-team" className={SELECT_TRIGGER}>
                <SelectValue placeholder={teams.isLoading ? '불러오는 중...' : '팀 선택'} />
              </SelectTrigger>
              <SelectContent>
                {(teams.data?.teams ?? []).map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="assign-role" className={FIELD_LABEL}>
              역할
            </Label>
            <Select value={role} onValueChange={(next) => setRole(next as TeamRole)}>
              <SelectTrigger id="assign-role" className={SELECT_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABEL) as TeamRole[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="assign-job-title" className={FIELD_LABEL}>
              직책 (선택)
            </Label>
            <Input
              id="assign-job-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={50}
              placeholder="부장"
              className={FIELD_INPUT}
            />
            <p className={FIELD_HINT}>비우면 직책 없음으로 저장됩니다.</p>
          </div>

          <p className="text-[11.5px] text-[#6E6E73]">
            배정 즉시 active 멤버십이 생기고 내부 설문 경로가 열립니다.
          </p>

          {error && <p className="text-[12.5px] text-red-600">{error}</p>}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#E5E5EA] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canAssign}
              className="flex items-center gap-1.5 rounded-lg bg-[#2E4FCE] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
            >
              {assign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}배정
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
