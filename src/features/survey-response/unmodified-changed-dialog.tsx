'use client';

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

/**
 * "달라졌다"고 밝혔는데 값이 지난 회차와 완전히 같은 문항을 제출 직전에 한 번 되묻는다.
 *
 * **막지 않는다** — 아홉 칸 중 여덟 칸이 지난 회차와 같은 것은 정상이고, 정말 한 칸도
 * 바뀌지 않았을 수도 있다. 실수로 열어만 두고 지나친 경우를 되돌아보게 하는 장치다.
 */
export function UnmodifiedChangedDialog({
  open,
  questionTitles,
  waveLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** 되묻는 문항의 제목 — 응답자가 어디로 돌아가야 하는지 알아야 한다. */
  questionTitles: string[];
  waveLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>고치지 않은 문항이 있습니다</AlertDialogTitle>
          <AlertDialogDescription>
            {`아래 문항은 달라졌다고 하셨지만 ${waveLabel} 답변과 똑같습니다. 이대로 제출해도 괜찮습니다.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-700">
          {questionTitles.map((title, index) => (
            <li key={`${title}-${index}`} className="break-keep">
              {title}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>돌아가서 확인</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>이대로 제출</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
