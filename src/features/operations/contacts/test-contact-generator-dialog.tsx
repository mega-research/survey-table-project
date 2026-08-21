'use client';

import { FormEvent, useRef, useState, useTransition } from 'react';

import { toast } from 'sonner';
import * as z from 'zod';

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
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

const generatorSchema = z.object({
  count: z.coerce.number().int().min(1).max(20),
  recipientEmail: z.string().email(),
});

interface Props {
  surveyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void | Promise<void>;
}

export function TestContactGeneratorDialog({ surveyId, open, onOpenChange, onCreated }: Props) {
  const [count, setCount] = useState('1');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [errors, setErrors] = useState<{ count?: string; recipientEmail?: string }>({});
  const [isPending, startTransition] = useTransition();
  const countInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) setErrors({});
    onOpenChange(nextOpen);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = generatorSchema.safeParse({ count, recipientEmail });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      const countError = fields.count?.[0];
      const emailError = fields.recipientEmail?.[0];
      setErrors({
        ...(countError ? { count: '생성 인원은 1명에서 20명 사이여야 합니다.' } : {}),
        ...(emailError ? { recipientEmail: '올바른 이메일 주소를 입력하세요.' } : {}),
      });
      if (countError) countInputRef.current?.focus();
      else if (emailError) emailInputRef.current?.focus();
      return;
    }

    startTransition(async () => {
      try {
        await client.contacts.targets.generateTest({ surveyId, ...parsed.data });
        toast.success(`테스트 대상자 ${parsed.data.count}명을 생성했습니다.`);
        updateOpen(false);
        await onCreated();
      } catch (error) {
        const message = getErrorMessage(error, '테스트 대상자 생성에 실패했습니다.');
        if (message.includes('TEST_TARGET_GENERATION_STALE')) {
          updateOpen(false);
          await onCreated();
          return;
        }
        toast.error(message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>테스트 대상자 생성</DialogTitle>
            <DialogDescription>
              샘플 대상자에게 같은 테스트 주소를 사용해 초대 링크와 메일 발송을 확인합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="test-contact-count">생성 인원</Label>
              <Input
                ref={countInputRef}
                id="test-contact-count"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                aria-invalid={errors.count ? true : undefined}
                aria-describedby={errors.count ? 'test-contact-count-error' : undefined}
              />
              {errors.count ? (
                <p id="test-contact-count-error" role="alert" className="text-sm text-red-600">
                  {errors.count}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-contact-email">메일 받을 테스트 주소</Label>
              <Input
                ref={emailInputRef}
                id="test-contact-email"
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                aria-invalid={errors.recipientEmail ? true : undefined}
                aria-describedby={errors.recipientEmail ? 'test-contact-email-error' : undefined}
              />
              {errors.recipientEmail ? (
                <p id="test-contact-email-error" role="alert" className="text-sm text-red-600">
                  {errors.recipientEmail}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => updateOpen(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={isPending}>
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
