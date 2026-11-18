'use client';

import { useState } from 'react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/lib/get-error-message';
import { CreateSurveyGroupInput, RenameSurveyGroupInput } from '@/shared/contracts/workspace-io';

import { useCreateSurveyGroup, useRenameSurveyGroup } from '../../queries/use-survey-groups';

/** 무엇을 하는 창인가 — 그룹 밑에 하위 그룹을 만들거나, 그룹의 이름을 바꾼다. */
export type GroupNameDialogTarget =
  | { kind: 'create-subgroup'; teamId: string; parent: { id: string; name: string } }
  | { kind: 'rename'; group: { id: string; name: string } };

/**
 * 그룹 이름 창 (3단계 시안 G1) — 「새 하위 그룹」과 폴더 줄 ⋯ 메뉴의 「이름 바꾸기」가 함께 쓴다.
 *
 * 둘 다 이름 하나를 받고, 거부되는 사유도 같다(같은 그룹 안의 같은 이름). 서버의 문구를 그대로
 * 보인다 — 「3단계까지만」처럼 그 사이 다른 팀원이 구조를 바꿔 생기는 거부도 여기로 온다.
 * 실패해도 그룹 목록은 다시 읽히므로(mutation 의 onSettled) 창을 닫으면 지금 구조가 보인다.
 */
export function GroupNameDialog({
  target,
  onClose,
}: {
  target: GroupNameDialogTarget;
  onClose: () => void;
}) {
  const isCreate = target.kind === 'create-subgroup';
  const [name, setName] = useState(isCreate ? '' : target.group.name);
  const [error, setError] = useState<string | null>(null);
  const createGroup = useCreateSurveyGroup();
  const renameGroup = useRenameSurveyGroup();
  const isPending = createGroup.isPending || renameGroup.isPending;

  async function submit() {
    setError(null);
    try {
      if (target.kind === 'create-subgroup') {
        const parsed = CreateSurveyGroupInput.safeParse({
          teamId: target.teamId,
          name,
          parentGroupId: target.parent.id,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await createGroup.mutateAsync(parsed.data);
        toast.success(`「${target.parent.name}」 안에 하위 그룹을 만들었습니다`);
      } else {
        const parsed = RenameSurveyGroupInput.safeParse({ groupId: target.group.id, name });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await renameGroup.mutateAsync(parsed.data);
      }
      onClose();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          isCreate ? '하위 그룹을 만들지 못했습니다.' : '그룹 이름을 바꾸지 못했습니다.',
        ),
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreate ? '새 하위 그룹' : '그룹 이름 바꾸기'}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? `「${target.parent.name}」 안에 만듭니다. 같은 그룹 안에서는 이름이 겹칠 수 없습니다.`
              : '같은 그룹 안에서는 이름이 겹칠 수 없습니다.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <Input
            aria-label="그룹 이름"
            value={name}
            maxLength={60}
            placeholder={isCreate ? '예: 2026' : undefined}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isCreate ? '만들기' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
