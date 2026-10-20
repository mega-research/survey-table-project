'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getErrorMessage } from '@/lib/get-error-message';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';
import { client } from '@/shared/lib/rpc';

/** 배정 없음 — Select 는 빈 문자열 값을 못 쓴다. */
const NONE_VALUE = '__none__';
const NEW_VALUE = '__new__';

export const ASSIGNMENT_NONE_LABEL = '(배정 없음)';

interface Props {
  surveyId: string;
  contactTargetId: string;
  currentAssignmentId: string | null;
  options: ContactAssignmentOption[];
}

/**
 * 조사 대상 상세의 「컨택원」 드롭다운 — 고르면 바로 저장된다(저장 버튼 없음).
 * 「(배정 없음)」으로 배정을 풀고, 「+ 새 컨택원」으로 이름만 적어 만들고 곧바로 배정한다.
 * 외부 주체 화면에는 그리지 않는다(호출부가 options 를 내리지 않는다).
 */
export function ContactAssignmentSelect({
  surveyId,
  contactTargetId,
  currentAssignmentId,
  options,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(currentAssignmentId ?? NONE_VALUE);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isPending, startTransition] = useTransition();

  // 저장 뒤 router.refresh 로 내려온 새 값에 맞춘다 — 렌더 중 조정 패턴.
  const [prevCurrent, setPrevCurrent] = useState(currentAssignmentId);
  if (prevCurrent !== currentAssignmentId) {
    setPrevCurrent(currentAssignmentId);
    setValue(currentAssignmentId ?? NONE_VALUE);
  }

  const save = (assignmentId: string | null, message: string) => {
    startTransition(async () => {
      try {
        await client.contacts.assignments.setTarget({ surveyId, contactTargetId, assignmentId });
        toast.success(message);
        router.refresh();
      } catch (err) {
        setValue(currentAssignmentId ?? NONE_VALUE);
        toast.error(getErrorMessage(err, '컨택원을 바꾸지 못했습니다.'));
      }
    });
  };

  const handleChange = (next: string) => {
    if (next === NEW_VALUE) {
      setCreating(true);
      return;
    }
    setValue(next);
    if (next === NONE_VALUE) {
      save(null, '배정을 풀었습니다.');
    } else {
      const name = options.find((o) => o.id === next)?.name ?? '';
      save(next, `${name}에 배정했습니다.`);
    }
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    startTransition(async () => {
      try {
        const created = await client.contacts.assignments.create({ surveyId, name });
        await client.contacts.assignments.setTarget({
          surveyId,
          contactTargetId,
          assignmentId: created.id,
        });
        setValue(created.id);
        setCreating(false);
        setNewName('');
        toast.success(`컨택원 ${created.name}을(를) 만들고 배정했습니다.`);
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '컨택원을 만들지 못했습니다.'));
      }
    });
  };

  return (
    <div className="flex items-start gap-3">
      <div className="w-40 shrink-0 pt-2 text-xs text-slate-600">컨택원</div>
      <div className="flex-1">
        <Select value={value} onValueChange={handleChange} disabled={isPending}>
          <SelectTrigger className="h-9 w-[240px]" aria-label="컨택원">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
            <SelectItem value={NONE_VALUE} className="text-slate-500">
              {ASSIGNMENT_NONE_LABEL}
            </SelectItem>
            <SelectSeparator />
            <SelectItem value={NEW_VALUE} className="text-blue-600">
              + 새 컨택원
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-slate-400">고르면 바로 저장됩니다.</p>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 컨택원</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <Input
              autoFocus
              aria-label="컨택원 이름"
              placeholder="예: 10차, 외주 A팀"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                취소
              </Button>
              <Button type="submit" disabled={isPending || newName.trim().length === 0}>
                만들고 배정
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
