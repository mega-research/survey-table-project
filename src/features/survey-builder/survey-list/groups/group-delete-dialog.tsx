'use client';

import { useState } from 'react';

import { FolderOpen, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';

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
import { getErrorMessage } from '@/lib/get-error-message';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { useRemoveSurveyGroup } from '../../queries/use-survey-groups';

interface GroupDeleteDialogProps {
  group: SurveyGroupListItem;
  onClose: () => void;
}

/**
 * 그룹 삭제 확인 (.pen FLOW 2-3).
 *
 * 팀 해산과 달리 이름 재입력 확인란이 없다 — 되돌릴 수 없는 일이 아니기 때문이다. 그룹만
 * 사라지고 설문은 전부 미분류로 돌아가며(FK ON DELETE SET NULL) 응답·공유·부여는 그대로다.
 * 영향 요약 두 줄이 그 사실을 미리 말해준다.
 */
export function GroupDeleteDialog({ group, onClose }: GroupDeleteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const removeGroup = useRemoveSurveyGroup();

  async function handleDelete() {
    setError(null);
    try {
      await removeGroup.mutateAsync(group.id);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '그룹을 삭제하지 못했습니다.'));
    }
  }

  return (
    <AlertDialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialogContent className="max-w-[460px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-[18px] w-[18px] text-[#EF4444]" />「{group.name}」 그룹을
            삭제할까요?
          </AlertDialogTitle>
          <AlertDialogDescription>그룹만 삭제되고 설문은 삭제되지 않습니다.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 rounded-[9px] bg-[#F5F5F7] px-3.5 py-3">
          <span className="flex items-center gap-2 text-[12.5px] text-[#374151]">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#6E6E73]" />
            설문 {group.surveyCount}개가 미분류로 이동합니다
          </span>
          <span className="flex items-center gap-2 text-[12.5px] text-[#374151]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#6E6E73]" />
            응답 데이터·공유 설정·게스트·실사 부여는 변하지 않습니다
          </span>
        </div>

        {error && <p className="text-[12.5px] text-red-600">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={removeGroup.isPending}
            onClick={handleDelete}
          >
            {removeGroup.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            그룹 삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
