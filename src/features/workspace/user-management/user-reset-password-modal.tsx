'use client';

import { useState } from 'react';

import { AlertCircle, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import { MIN_PASSWORD_LENGTH, ResetUserPasswordInput } from '@/shared/contracts/auth-io';
import type { UserListItem } from '@/shared/contracts/auth-io';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from './field-styles';
import { useResetUserPassword } from './queries/use-users';


interface Props {
  /** 대상 사용자. 이 모달은 열릴 때만 마운트되므로 null 이 오지 않는다. */
  user: UserListItem;
  onClose: () => void;
}

/**
 * 비밀번호 재설정 모달 (.pen FLOW 1-3).
 *
 * 이메일 재설정 링크 플로우는 없다(ADR-0018) — 슈퍼어드민이 새 임시 비밀번호를 직접 정하고
 * 사내 채널로 전달한다. 저장과 동시에 대상의 모든 세션이 끊긴다는 점을 화면에서 먼저 말한다.
 */
export function UserResetPasswordModal({ user, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: resetPassword, isPending } = useResetUserPassword();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // 길이 규칙은 경계 계약 한 곳에만 둔다 — 여기서 손으로 재현하면 서버와 갈린다.
    const parsed = ResetUserPasswordInput.safeParse({ userId: user.id, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }

    try {
      await resetPassword(parsed.data);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '비밀번호를 재설정하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[460px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          비밀번호 재설정
        </DialogTitle>
        <p className="mt-1 text-[12px] text-[#6E6E73]">
          {user.name} · {user.email}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="space-y-2">
            <Label htmlFor="reset-password" className={FIELD_LABEL}>
              새 임시 비밀번호
            </Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={FIELD_INPUT}
            />
            <p className={FIELD_HINT}>{MIN_PASSWORD_LENGTH}자 이상</p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#B45309]">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>저장 즉시 이 계정의 모든 세션이 폐기됩니다.</span>
          </div>

          <p className="text-[11px] text-[#9CA3AF]">
            임시 비밀번호는 사내 메신저·구두 등 별도 채널로 전달하고, 사용자는 로그인 후
            프로필에서 변경합니다. 이메일 재설정 링크는 없습니다.
          </p>

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
              {isPending ? '재설정 중...' : '재설정'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
