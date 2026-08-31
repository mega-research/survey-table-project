'use client';

import { useState } from 'react';

import { Building2, ChevronDown, ChevronRight, MoreVertical, Plus } from 'lucide-react';

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
import { FIELDWORK_ROLE_LABEL, type UserStatus } from '@/shared/contracts/auth';
import type { FieldworkOrgListItem } from '@/shared/contracts/workspace-io';

import { USER_STATUS_LABEL } from '../user-management/user-vocabulary';
import { useArchiveFieldworkOrg } from './queries/use-fieldwork-orgs';

const STATUS_PILL: Record<UserStatus, string> = {
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  active: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#F5F5F7] text-[#6E6E73]',
  suspended: 'bg-[#FEF3C7] text-[#D97706]',
  departed: 'bg-[#F5F5F7] text-[#6E6E73]',
};

interface Props {
  org: FieldworkOrgListItem;
  /** 첫 카드만 펼친 채로 연다 — .pen 10-4 가 그렇게 그린다. */
  defaultExpanded?: boolean;
  onEdit: (org: FieldworkOrgListItem) => void;
  /** 계정 발급 — 소속 업체가 미리 정해진 생성 모달을 연다. */
  onIssueAccount: (org: FieldworkOrgListItem) => void;
}

/**
 * 실사 업체 카드 (.pen FLOW 10-4).
 *
 * 부제의 인원은 **재직 중만** 센다(서버가 그렇게 준다) — 카드가 답해야 하는 질문이
 * 「지금 몇 명이 뛰는가」이기 때문이다. 반면 펼친 명단은 정지·퇴사까지 보여준다: 「왜 인원이
 * 줄었는가」는 명단에서만 읽히고, 그 사람을 되살리는 것도 사용자 관리 탭의 일이다.
 */
export function FieldworkOrgCard({ org, defaultExpanded = false, onEdit, onIssueAccount }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: archiveOrg, isPending } = useArchiveFieldworkOrg();

  async function handleArchive() {
    setError(null);
    try {
      await archiveOrg({ orgId: org.id });
      setConfirmingArchive(false);
    } catch (err) {
      // 재직 중 계정이 남아 있으면 서버가 CONFLICT 로 막는다 — 문구를 그대로 보여준다.
      setError(getErrorMessage(err, '업체를 종료하지 못했습니다.'));
    }
  }

  return (
    <div className="overflow-hidden rounded-[11px] border border-[#E5E5EA] bg-white">
      <div className="flex items-center gap-3 px-5 py-4">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF2FF] text-[#2743AE]"
        >
          <Building2 className="h-[18px] w-[18px]" />
        </span>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate text-[14.5px] font-semibold text-[#1C1C1E]">
                {org.name}
              </span>
              <span className="inline-flex rounded-full bg-[#DCFCE7] px-2 py-[2px] text-[10.5px] font-semibold text-[#15803D]">
                active
              </span>
            </span>
            <span className="text-[11.5px] text-[#9CA3AF]">
              팀장 {org.leaderCount} · 실사원 {org.workerCount} · 초대된 설문{' '}
              {org.invitedSurveyCount}건{org.memo ? ` · ${org.memo}` : ''}
            </span>
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-[#9CA3AF]" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#9CA3AF]" />
          )}
        </button>

        <Button
          type="button"
          variant="outline"
          onClick={() => onIssueAccount(org)}
          className="h-[32px] rounded-[9px] border-[#D1D5DB] px-3 text-[12.5px] font-semibold text-[#374151]"
        >
          <Plus className="mr-1 h-[14px] w-[14px]" />
          계정 발급
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 p-0 text-[#6E6E73]"
              aria-label={`${org.name} 업체 메뉴`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[160px]">
            <DropdownMenuItem onSelect={() => onEdit(org)}>업체 설정</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setConfirmingArchive(true)}
              className="text-red-600 focus:text-red-600"
            >
              업체 종료
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <div className="border-t border-[#F0F0F3]">
          {org.accounts.length === 0 ? (
            <p className="px-5 py-6 text-center text-[12.5px] text-[#9CA3AF]">
              발급된 계정이 없습니다.
            </p>
          ) : (
            org.accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 border-t border-[#F5F5F7] px-5 py-3 first:border-t-0"
              >
                <span
                  aria-hidden
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#F3F4F6] text-[11.5px] font-semibold text-[#6E6E73]"
                >
                  {account.name.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-[#1C1C1E]">
                      {account.name}
                    </span>
                    <span className="inline-flex rounded-full bg-[#EEF2FF] px-2 py-[2px] text-[10.5px] font-semibold text-[#2743AE]">
                      {FIELDWORK_ROLE_LABEL[account.fieldworkRole]}
                    </span>
                  </span>
                  <span className="truncate text-[11.5px] text-[#9CA3AF]">{account.email}</span>
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold ${STATUS_PILL[account.status]}`}
                >
                  {USER_STATUS_LABEL[account.status]}
                </span>
              </div>
            ))
          )}
          {/* 계정의 상태 전이·비밀번호 재설정은 사용자 관리 탭이 진다 — 케밥을 두 벌 두면
              전이표가 두 화면에 복제되고, 실제로 그 표는 한 곳(USER_STATUS_TRANSITIONS)이다. */}
          <p className="border-t border-[#F5F5F7] px-5 py-3 text-[11px] text-[#9CA3AF]">
            상태 변경·비밀번호 재설정은 「사용자」 탭에서 합니다.
          </p>
        </div>
      )}

      <AlertDialog
        open={confirmingArchive}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmingArchive(false);
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{org.name} 업체를 종료할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              종료하면 목록에서 사라지고 새 계정을 발급할 수 없습니다. 되돌릴 수 없으며, 재직 중인
              계정이 남아 있으면 종료되지 않습니다. 소속 계정 기록은 그대로 남습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-[12.5px] text-red-600">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            <Button
              type="button"
              onClick={handleArchive}
              disabled={isPending}
              className="h-[38px] rounded-[9px] bg-red-600 px-4 text-[13px] font-semibold text-white hover:bg-red-700"
            >
              {isPending ? '종료 중...' : '업체 종료'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
