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
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

import { assignmentEditHref } from './assignment-hrefs';

/** 「+ 컨택원 추가」 — 이름만 적어 만들고, 배정할 대상을 고르는 수정 화면으로 간다. */
export function AddAssignmentButton({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (name.trim().length === 0) return;
    startTransition(async () => {
      try {
        const created = await client.contacts.assignments.create({ surveyId, name });
        setOpen(false);
        setName('');
        router.push(assignmentEditHref(surveyId, created.id));
      } catch (err) {
        toast.error(getErrorMessage(err, '컨택원을 만들지 못했습니다.'));
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + 컨택원 추가
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 컨택원</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              autoFocus
              aria-label="컨택원 이름"
              placeholder="예: 10차, 외주 A팀"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500">
              만든 뒤 배정할 대상을 조건으로 고릅니다. 이름은 나중에 바꿀 수 있습니다.
            </p>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={isPending || name.trim().length === 0}>
                만들기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
