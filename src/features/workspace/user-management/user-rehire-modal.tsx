'use client';

import { useState } from 'react';

import { AlertCircle, ArrowRight, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import { ChangeUserStatusInput, MIN_PASSWORD_LENGTH } from '@/shared/contracts/auth-io';
import type { UserListItem } from '@/shared/contracts/auth-io';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useChangeUserStatus } from './queries/use-users';
import { USER_STATUS_LABEL } from './user-vocabulary';


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
 * .pen 의 「새 소속 팀」·「팀 역할」은 자리만 두고 비활성이다 — 팀 엔티티는 티켓 06 에서
 * 생기고 재입사 시 팀 배정 연계는 티켓 14 소관이라, 지금 받으면 저장할 곳이 없다.
 */
export function UserRehireModal({ user, onClose }: Props) {
  const [password, setPassword] = useState('');
  // 지금 직책을 채워 연다. 보낸 값이 곧 저장될 값이라(서비스가 비운 값을 지운다) 채우지
  // 않으면 비밀번호만 입력하고 제출한 순간 멀쩡한 직책이 조용히 사라진다.
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: changeStatus, isPending } = useChangeUserStatus();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = ChangeUserStatusInput.safeParse({
      action: 'rehire',
      userId: user.id,
      password,
      jobTitle,
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
        <p className="mt-1 text-[12px] text-[#6E6E73]">
          퇴사 계정을 새 소속으로 다시 시작합니다.
        </p>

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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rehire-team" className={FIELD_LABEL}>
                새 소속 팀
              </Label>
              <Input
                id="rehire-team"
                disabled
                placeholder="팀 기능 도입 후 사용"
                className={FIELD_INPUT}
              />
              <p className={FIELD_HINT}>팀 배정은 팀 기능 도입 이후에 붙습니다.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rehire-team-role" className={FIELD_LABEL}>
                팀 역할
              </Label>
              <Input
                id="rehire-team-role"
                disabled
                placeholder="팀 기능 도입 후 사용"
                className={FIELD_INPUT}
              />
              <p className={FIELD_HINT}>팀장 지정 규칙도 그때 함께 검사합니다.</p>
            </div>
          </div>

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
