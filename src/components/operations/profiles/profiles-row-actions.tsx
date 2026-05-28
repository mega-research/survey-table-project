'use client';

import { useState, useTransition } from 'react';

import { MoreHorizontal } from 'lucide-react';

import {
  hardResetResponse,
  restoreResponse,
  softDeleteResponse,
} from '@/actions/profiles-row-actions';
import type { ProfilesView } from '@/lib/operations/profiles';
import {
  AlertDialog,
  AlertDialogAction,
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

interface Props {
  surveyId: string;
  responseId: string;
  idx: number;
  view: ProfilesView;
}

type Dialog = null | 'edit' | 'delete' | 'reset';

export function ProfilesRowActions({ surveyId, responseId, idx, view }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [isPending, startTransition] = useTransition();

  const runConfirmed = (fn: (s: string, r: string) => Promise<unknown>) => {
    startTransition(async () => {
      try {
        await fn(surveyId, responseId);
        setDialog(null);
      } catch {
        window.alert('응답 처리에 실패했습니다. 다시 시도해 주세요.');
        // dialog 유지 — 사용자 재시도 가능
      }
    });
  };

  const editHref = `/admin/surveys/${surveyId}/operations/profiles/${responseId}/edit?idx=${idx}`;

  const openEditor = () => {
    window.open(editHref, '_blank', 'noopener,noreferrer');
    setDialog(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`응답 #${idx} 액션`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {view === 'active' ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog('edit')}>수정</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('delete')}>삭제</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog('reset')}
                className="text-red-600 focus:text-red-700"
              >
                초기화
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              disabled={isPending}
              onSelect={() => runConfirmed(restoreResponse)}
            >
              복원
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 수정 — 규칙 안내 후 새 탭으로 수정 화면 진입 */}
      <AlertDialog open={dialog === 'edit'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 수정합니다</AlertDialogTitle>
            <AlertDialogDescription>
              새 탭의 수정 화면에서 응답 내용을 바꿔 저장하면 기존 응답이 갱신됩니다. 시작·종료일시는
              그대로 유지되고 수정 시각이 따로 기록되며, 통계와 기록에도 수정된 내용이 반영됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={openEditor}>수정 화면 열기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 삭제 — 통계/기록에서 제외하되 복원 가능 (soft delete) */}
      <AlertDialog open={dialog === 'delete'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 삭제합니다</AlertDialogTitle>
            <AlertDialogDescription>
              통계와 기록(현황·진척률·내보내기)에서 제외됩니다. 휴지통에 보관되며 언제든 다시 복원할
              수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => runConfirmed(softDeleteResponse)}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 초기화 — 응답을 완전 제거, 복구 불가 (hard reset) */}
      <AlertDialog open={dialog === 'reset'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 초기화합니다</AlertDialogTitle>
            <AlertDialogDescription>
              응답이 통계와 기록에서 완전히 사라지며 복구할 수 없습니다. 컨택 명단의 진척 상태도 함께
              되돌아갑니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => runConfirmed(hardResetResponse)}
              className="bg-red-600 hover:bg-red-700"
            >
              초기화
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
