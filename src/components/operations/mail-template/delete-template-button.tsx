'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  templateId: string;
  templateName: string;
}

export function DeleteTemplateButton({ surveyId, templateId, templateName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      try {
        await client.mail.templates.remove({ surveyId, templateId });
      } catch (err) {
        alert(getErrorMessage(err, '삭제 실패'));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${templateName} 삭제`}
          className="text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>템플릿을 삭제하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-gray-900">&ldquo;{templateName}&rdquo;</span> 을(를)
            삭제합니다. 이 작업은 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {pending ? '삭제 중...' : '삭제'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
