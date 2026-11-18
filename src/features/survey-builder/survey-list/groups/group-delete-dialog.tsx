'use client';

import { useState } from 'react';

import { ORPCError } from '@orpc/client';
import { Loader2 } from 'lucide-react';

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
import { SurveyGroupRemoveConflict } from '@/shared/contracts/workspace-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { useRemoveSurveyGroup, useSurveyGroups } from '../../queries/use-survey-groups';
import {
  describeGroupDelete,
  describeGroupDeleteBlocked,
  planGroupDelete,
} from './group-delete-plan';

interface GroupDeleteDialogProps {
  group: Pick<SurveyGroupListItem, 'id' | 'name' | 'parentGroupId'>;
  /** 그 그룹의 팀 — 올라갈 자리와 하위 그룹의 이름을 그룹 목록(같은 캐시)에서 읽는다. */
  teamId: string;
  onClose: () => void;
}

/**
 * 그룹 삭제 확인 (.pen FLOW 2-3 · 3단계 시안 G4).
 *
 * 그룹만 사라지고 **내용물은 한 단계 위로 올라간다** — 하위 그룹은 지운 그룹의 부모 밑으로,
 * 직접 담긴 설문은 그 부모 그룹으로(최상위였으면 미분류). 문구가 올라갈 자리의 이름을 말한다.
 * 팀 해산과 달리 이름 재입력 확인란이 없다: 설문·응답·공유 설정은 그대로라 잃는 것이 없다.
 *
 * **설문 건수는 적지 않는다** — 내가 볼 수 없는 설문이 담겨 있을 수 있다.
 *
 * 올라갈 자리에 같은 이름의 그룹이 있으면 서버가 아무것도 바꾸지 않고 거부하며 겹치는 이름을
 * 준다(내게 보이는 그룹의 것만 — 하나도 안 보이면 이름 없이 온다). 그때는 같은 창이 「삭제할 수
 * 없습니다」로 바뀌어 무엇을 고치면 되는지 말한다. 문구는 서버의 메시지가 아니라 **값**으로 짓는다
 * (메시지에는 이름이 없다). 겹침을 화면이 미리 판정하지 않는 것은 목록이 낡았을 수 있어서다 —
 * 판정은 서버 하나다.
 */
export function GroupDeleteDialog({ group, teamId, onClose }: GroupDeleteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SurveyGroupRemoveConflict | null>(null);
  const { data: groups } = useSurveyGroups(teamId);
  const removeGroup = useRemoveSurveyGroup();
  const plan = planGroupDelete(groups ?? [], group);

  async function handleDelete() {
    setError(null);
    try {
      await removeGroup.mutateAsync(group.id);
      onClose();
    } catch (err) {
      const blocked = readRemoveConflict(err);
      if (blocked) setConflict(blocked);
      else setError(getErrorMessage(err, '그룹을 삭제하지 못했습니다.'));
    }
  }

  return (
    <AlertDialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialogContent className="max-w-[460px]">
        {conflict ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                「{group.name}」 그룹을 삭제할 수 없습니다
              </AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                {describeGroupDeleteBlocked(plan, conflict)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" onClick={onClose}>
                확인
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                「{group.name}」 그룹을 삭제할까요?
              </AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                {describeGroupDelete(plan)}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {error && (
              <p role="alert" className="text-[12.5px] text-red-600">
                {error}
              </p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeGroup.isPending}>취소</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={removeGroup.isPending}
                onClick={handleDelete}
              >
                {removeGroup.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                삭제
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 삭제가 이름 겹침으로 막힌 것이면 서버가 실어 준 값을, 아니면 null 을 돌려준다. */
function readRemoveConflict(err: unknown): SurveyGroupRemoveConflict | null {
  if (!(err instanceof ORPCError) || err.code !== 'CONFLICT') return null;
  const parsed = SurveyGroupRemoveConflict.safeParse(err.data);
  return parsed.success ? parsed.data : null;
}
