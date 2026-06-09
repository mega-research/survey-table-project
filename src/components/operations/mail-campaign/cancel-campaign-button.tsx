'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  campaignId: string;
}

export function CancelCampaignButton({ surveyId, campaignId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        await client.mail.campaigns.cancel({ surveyId, campaignId });
      } catch (err) {
        alert(getErrorMessage(err, '취소 실패'));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        단체 메일 취소
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>단체 메일 취소</DialogTitle>
            <DialogDescription>
              아직 발송이 시작되지 않은 수신자만 영향을 받습니다. 이미 발송 진행 중이면 취소할 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              돌아가기
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
              {isPending ? '취소 중…' : '단체 메일 취소'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
