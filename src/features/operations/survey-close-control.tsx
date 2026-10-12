'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { CircleStop } from 'lucide-react';
import { toast } from 'sonner';

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
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  initialClosed: boolean;
}

/**
 * 운영 헤더의 설문 종료 스위치 (ADR-0030).
 *
 * 중단 버튼 옆에 서지만 뜻이 다르다 — 중단은 「잠깐 멈춤」이고 종료는 「조사가 끝나 외부
 * 접근을 전부 닫는다」다. 그래서 중단과 달리 문구 입력이 없고(응답자에게는 기존 안내가
 * 나간다), 대신 확인 창이 **무엇이 바뀌는지**를 말한다. 「진행 중 응답은 제출된다」와
 * 「메일은 계속 나간다」는 버튼 이름에서 짐작할 수 없다.
 *
 * 다른 탭에서 바뀐 종료 상태를 따라가지 않는다 — 중단 버튼과 같은 한계다(헤더 폴링은
 * 테스트 모드만 동기화한다).
 */
export function SurveyCloseControl({ surveyId, initialClosed }: Props) {
  const router = useRouter();
  const [isClosed, setIsClosed] = useState(initialClosed);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const apply = (next: boolean) =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setClosed({ surveyId, isClosed: next });
        setIsClosed(result.isClosed);
        setConfirmOpen(false);
        toast.success(next ? '설문을 종료했습니다.' : '설문 종료를 취소했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(
          getErrorMessage(err, next ? '설문 종료에 실패했습니다.' : '종료 취소에 실패했습니다.'),
        );
      }
    });

  return (
    <>
      {isClosed ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
          className="border-slate-400 bg-slate-100 text-slate-700 hover:bg-slate-200"
        >
          <CircleStop className="mr-2 h-4 w-4" />
          종료됨
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <CircleStop className="mr-2 h-4 w-4" />
          설문 종료
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isClosed ? '설문 종료를 취소할까요?' : '설문을 종료할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {isClosed ? (
                <div className="space-y-2 text-sm text-gray-600">
                  <p>종료를 취소하면 새 응답을 다시 받습니다.</p>
                  <p>
                    외주 실사 링크와 클라이언트 링크는 같은 주소와 같은 비밀번호로 다시 열립니다.
                    설문을 중단해 두었다면 중단 상태는 그대로입니다.
                  </p>
                </div>
              ) : (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-600">
                  <li>새 응답을 받지 않습니다.</li>
                  <li>외주 실사 링크와 클라이언트 링크가 닫힙니다.</li>
                  <li>응답하던 사람은 끝까지 제출할 수 있습니다.</li>
                  <li>메일은 계속 발송됩니다. 예약된 발송도 그대로 나갑니다.</li>
                </ul>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>닫기</AlertDialogCancel>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 확인 창을 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                apply(!isClosed);
              }}
            >
              {isClosed ? '종료 취소' : '종료'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
