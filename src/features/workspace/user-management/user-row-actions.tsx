'use client';

import { useState } from 'react';

import { MoreVertical } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getErrorMessage } from '@/lib/get-error-message';
import { type UserStatusAction, availableUserStatusActions } from '@/shared/contracts/auth';
import type { UserListItem } from '@/shared/contracts/auth-io';

import { useChangeUserStatus } from './queries/use-users';
import { USER_STATUS_ACTION_LABEL } from './user-vocabulary';

/** 확인 다이얼로그 문구 — 되돌리기 비용이 다른 만큼 정지와 퇴사를 같은 문장으로 묻지 않는다. */
const CONFIRM_COPY: Record<Exclude<UserStatusAction, 'rehire'>, string> = {
  suspend:
    '일시 정지하면 이 계정의 모든 세션이 폐기되고 로그인이 막힙니다. 재직 복귀로 언제든 되돌릴 수 있습니다.',
  resume: '재직 복귀하면 다시 로그인할 수 있습니다. 기존 세션은 폐기된 채로 남습니다.',
  depart:
    '퇴사 처리하면 모든 세션이 폐기되고 로그인이 막힙니다. 되돌리려면 재입사 처리가 필요하며, 일반 재직 복귀로는 돌아올 수 없습니다.',
};

interface Props {
  user: UserListItem;
  /** 재입사는 입력이 필요해 확인 다이얼로그가 아니라 전용 모달을 연다. */
  onRehire: (user: UserListItem) => void;
  onResetPassword: (user: UserListItem) => void;
}

/**
 * 사용자 행 케밥 (.pen FLOW 1-1 액션 열).
 *
 * 여는 항목은 전이표(availableUserStatusActions)가 정한다 — 서버 강제와 같은 표를 보므로
 * 화면에 뜬 액션이 서버에서 거부되는 어긋남이 생기지 않는다. 그래도 판정자는 서버다:
 * 목록을 띄워둔 사이 상태가 바뀌면 열려 있던 메뉴가 낡은 것이라, 실패 문구를 그대로 띄운다.
 */
export function UserRowActions({ user, onRehire, onResetPassword }: Props) {
  const [confirming, setConfirming] = useState<Exclude<UserStatusAction, 'rehire'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: changeStatus, isPending } = useChangeUserStatus();

  const actions = availableUserStatusActions(user.status);

  function closeConfirm() {
    setConfirming(null);
    setError(null);
  }

  function openAction(action: UserStatusAction) {
    if (action === 'rehire') {
      onRehire(user);
      return;
    }
    setError(null);
    setConfirming(action);
  }

  async function confirm() {
    if (!confirming) return;
    setError(null);
    try {
      await changeStatus({ action: confirming, userId: user.id });
      closeConfirm();
    } catch (err) {
      setError(getErrorMessage(err, '상태를 바꾸지 못했습니다.'));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[#9CA3AF] hover:text-[#3A3A3C]"
            aria-label={`${user.name} 액션`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onResetPassword(user)}>
            비밀번호 재설정
          </DropdownMenuItem>
          {actions.length > 0 && <DropdownMenuSeparator />}
          {actions.map((action) => (
            <DropdownMenuItem
              key={action}
              onSelect={() => openAction(action)}
              className={action === 'depart' ? 'text-red-600 focus:text-red-700' : undefined}
            >
              {USER_STATUS_ACTION_LABEL[action]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : closeConfirm())}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {user.name} 님을 {confirming ? USER_STATUS_ACTION_LABEL[confirming] : ''}할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? CONFIRM_COPY[confirming] : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            {/* AlertDialogAction 은 클릭 즉시 닫힌다. 실패 문구를 같은 자리에 띄워야 하므로
                닫기를 우리가 제어하는 일반 버튼을 쓴다. */}
            <Button
              type="button"
              onClick={confirm}
              disabled={isPending}
              className={
                confirming === 'depart'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-[#2E4FCE] text-white hover:bg-[#2743AE]'
              }
            >
              {isPending ? '처리 중...' : confirming ? USER_STATUS_ACTION_LABEL[confirming] : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
