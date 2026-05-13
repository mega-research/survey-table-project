'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { revertUnsubscribeByContactIdAction } from '@/actions/unsubscribe-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  surveyId: string;
  contactId: string;
  emailMasked: string;
}

export function UnsubscribedRevertButton({ surveyId, contactId, emailMasked }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await revertUnsubscribeByContactIdAction(contactId, surveyId);
      if (!result.ok) {
        alert(result.error ?? '해제 실패');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        해제
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>수신거부 해제</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-slate-900">{emailMasked}</span> 컨택의 수신거부를
              해제합니다. 이후 캠페인에서 다시 발송 대상에 포함됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              돌아가기
            </Button>
            <Button onClick={onConfirm} disabled={isPending}>
              {isPending ? '해제 중…' : '해제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
