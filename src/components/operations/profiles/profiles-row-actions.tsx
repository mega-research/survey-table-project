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

type Dialog = null | 'delete' | 'reset';

export function ProfilesRowActions({ surveyId, responseId, idx, view }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [isPending, startTransition] = useTransition();

  const runConfirmed = (
    fn: (s: string, r: string) => Promise<unknown>,
  ) => {
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
              <DropdownMenuItem
                onSelect={() => window.open(editHref, '_blank')}
              >
                수정
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('reset')}>
                초기화
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog('delete')}
                className="text-red-600 focus:text-red-700"
              >
                삭제
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

      <AlertDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 삭제합니다</AlertDialogTitle>
            <AlertDialogDescription>
              통계에서 제외되며 휴지통에서 복원 가능합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => runConfirmed(softDeleteResponse)}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'reset'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>응답 #{idx}를 완전히 제거합니다</AlertDialogTitle>
            <AlertDialogDescription>
              응답 데이터는 복구할 수 없습니다. 컨택 명단의 진척 상태도 함께 되돌아갑니다.
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
