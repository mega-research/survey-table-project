'use client';

import { useState } from 'react';

import { AlertCircle, ArrowRight, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { ChangeUserStatusInput, MIN_PASSWORD_LENGTH } from '@/shared/contracts/auth-io';
import type { UserListItem } from '@/shared/contracts/auth-io';
import type { TeamRole } from '@/shared/contracts/workspace';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useTeams } from '../team-management/queries/use-teams';
import { useChangeUserStatus } from './queries/use-users';
import { USER_STATUS_LABEL } from './user-vocabulary';

const ROLE_LABEL: Record<TeamRole, string> = { member: '팀원', leader: '팀장' };

/**
 * 이 계정이 팀에 소속될 수 있는가 — 서버의 requiresTeamAssignment 와 같은 규칙.
 *
 * guest·fieldwork 는 멤버십 자체가 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관하다.
 * 그 계정에 팀 칸을 보여주면 채울 수 없는 필수 칸이 되어 재입사가 영영 막힌 것처럼 보인다.
 */
function requiresTeamAssignment(user: UserListItem): boolean {
  return user.userType === 'internal' && !user.isSuperadmin;
}

interface Props {
  /** 대상 사용자. 이 모달은 열릴 때만 마운트되므로 null 이 오지 않는다. */
  user: UserListItem;
  onClose: () => void;
}

/**
 * 재입사 처리 모달 (.pen FLOW 9-4 — 메일 문구 없음 버전).
 *
 * 퇴사자는 일반 재직 복귀로 살리지 않는다(ADR-0010). 새 임시 비밀번호를 정하는 것이
 * 이 화면의 필수 입력이고, 재설정 메일은 발송하지 않는다.
 *
 * **내부 일반 계정에는 「새 소속 팀」이 필수다**(티켓 14). 상태만 되돌리면 로그인만 되는
 * 미배치로 되살아나 재배치 센터로 다시 흘러간다 — 「새 소속으로 다시 시작」이라고 말하는
 * 화면이 목적지를 안 받으면 그 문장이 거짓이 된다. 상태 전이와 옛 소속 정리와 새 배정은
 * 서버에서 한 트랜잭션이라(server/workflows/user-rehire) 배정이 막히면 계정도 퇴사 상태로 남는다.
 *
 * 팀에 소속될 수 없는 계정(guest·실사·슈퍼어드민)에는 두 칸이 아예 없다 — 채울 수 없는
 * 필수 칸을 보여주면 그 계정은 영영 못 돌아오는 것처럼 보인다.
 */
export function UserRehireModal({ user, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamRole, setTeamRole] = useState<TeamRole>('member');
  const needsTeam = requiresTeamAssignment(user);
  // 팀 목록은 칸이 있을 때만 필요하다 — 없는 화면에서 부르면 쓰지도 않을 왕복이 하나 는다.
  const teams = useTeams(needsTeam);
  // 지금 직책을 채워 연다. 보낸 값이 곧 저장될 값이라(서비스가 비운 값을 지운다) 채우지
  // 않으면 비밀번호만 입력하고 제출한 순간 멀쩡한 직책이 조용히 사라진다.
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: changeStatus, isPending } = useChangeUserStatus();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // **팀 필수 여부는 계약이 아니라 유형별 규칙이라 화면이 직접 본다.** 계약의 teamId 는
    // nullable 이다 — 팀에 소속될 수 없는 계정을 위해서다. 그래서 zod 는 여기를 잡아주지
    // 않고, 안 막으면 「필수」 별표를 달아둔 칸을 비운 채 제출돼 서버가 CONFLICT 로 되돌린다.
    if (needsTeam && teamId === null) {
      setError('새 소속 팀을 선택하세요.');
      return;
    }

    const parsed = ChangeUserStatusInput.safeParse({
      action: 'rehire',
      userId: user.id,
      password,
      jobTitle,
      teamId: needsTeam ? teamId : null,
      teamRole: needsTeam ? teamRole : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }

    try {
      await changeStatus(parsed.data);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '재입사 처리를 하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[520px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          재입사 처리 — {user.name}
        </DialogTitle>
        <p className="mt-1 text-[12px] text-[#6E6E73]">퇴사 계정을 새 소속으로 다시 시작합니다.</p>

        <div className="mt-4 flex items-center gap-2 text-[11.5px] font-semibold">
          <span className="inline-flex rounded-full bg-[#F5F5F7] px-2 py-[3px] text-[#6E6E73]">
            {USER_STATUS_LABEL.departed}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-[#9CA3AF]" />
          <span className="inline-flex rounded-full bg-[#DCFCE7] px-2 py-[3px] text-[#15803D]">
            {USER_STATUS_LABEL.active}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="flex items-center gap-2 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1D4ED8]">
            <Info className="h-4 w-4 flex-shrink-0" />
            <span>이전 팀 멤버십과 설문 초대는 자동 복구하지 않습니다.</span>
          </div>

          {needsTeam && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rehire-team" className={FIELD_LABEL}>
                  새 소속 팀 *
                </Label>
                {/* 미선택은 빈 문자열로 계속 제어한다 — 붙였다 뗐다 하면 Radix 가 비제어로
                  전환돼 트리거가 빈칸으로 굳는다(reassignment/assignment-fields 의 같은 주석). */}
                <Select value={teamId ?? ''} onValueChange={setTeamId}>
                  <SelectTrigger id="rehire-team" className={FIELD_INPUT}>
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
                <p className={FIELD_HINT}>active 팀을 1개 이상 지정해야 합니다.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rehire-team-role" className={FIELD_LABEL}>
                  팀 역할 *
                </Label>
                <Select value={teamRole} onValueChange={(next) => setTeamRole(next as TeamRole)}>
                  <SelectTrigger id="rehire-team-role" className={FIELD_INPUT}>
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
                <p className={FIELD_HINT}>팀장 지정은 선택한 팀의 마지막 팀장 규칙을 확인합니다.</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rehire-password" className={FIELD_LABEL}>
              새 임시 비밀번호
            </Label>
            <Input
              id="rehire-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={FIELD_INPUT}
            />
            <p className={FIELD_HINT}>
              {MIN_PASSWORD_LENGTH}자 이상 · 별도 채널로 전달 · 재설정 메일은 없습니다
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rehire-job-title" className={FIELD_LABEL}>
              직책
            </Label>
            <Input
              id="rehire-job-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={50}
              className={FIELD_INPUT}
            />
            <p className={FIELD_HINT}>필요한 경우 수정할 수 있습니다. 비우면 지웁니다.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="h-[34px] rounded-[9px] border-[#D1D5DB] px-4 text-[13px] font-semibold text-[#374151]"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-[34px] rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
            >
              {isPending ? '처리 중...' : '재입사 처리'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
