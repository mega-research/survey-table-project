'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { CirclePause, CirclePlay } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';

import { TestModeControl } from './test-mode-control';

interface Props {
  surveyId: string;
  initial: {
    isPaused: boolean;
    pausedMessage: string | null;
    testModeEnabled: boolean;
    testToken: string | null;
    accessIdentifier: string;
  };
}

/**
 * 운영 헤더의 설문 중단·테스트 모드 토글 버튼.
 *
 * - 테스트 모드: TestModeControl (설문 편집 헤더와 공용) 에 위임.
 * - 중단: 응답자 화면에 안내 문구만 노출하고 신규 응답 접수를 막는다. ON 이면 rose 톤으로
 *   "중단 중" 을 표시하고 클릭 시 재개 확인을 받는다.
 */
export function SurveyControlButtons({ surveyId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState({
    isPaused: initial.isPaused,
    pausedMessage: initial.pausedMessage,
  });
  const [isPending, startTransition] = useTransition();
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const [pauseMessage, setPauseMessage] = useState(
    initial.pausedMessage ?? DEFAULT_PAUSED_MESSAGE,
  );

  const pauseSurvey = () =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setPaused({
          surveyId,
          isPaused: true,
          pausedMessage: pauseMessage.trim() || DEFAULT_PAUSED_MESSAGE,
        });
        setState((s) => ({ ...s, ...result }));
        setPauseDialogOpen(false);
        toast.success('설문을 중단했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '설문 중단에 실패했습니다.'));
      }
    });

  const resumeSurvey = () =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setPaused({ surveyId, isPaused: false });
        setState((s) => ({ ...s, ...result }));
        setResumeConfirmOpen(false);
        toast.success('설문을 재개했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '설문 재개에 실패했습니다.'));
      }
    });

  return (
    <>
      <TestModeControl
        surveyId={surveyId}
        initial={{
          testModeEnabled: initial.testModeEnabled,
          testToken: initial.testToken,
          accessIdentifier: initial.accessIdentifier,
        }}
      />

      {state.isPaused ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setResumeConfirmOpen(true)}
          className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
        >
          <CirclePlay className="mr-2 h-4 w-4" />
          중단 중
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setPauseDialogOpen(true)}
        >
          <CirclePause className="mr-2 h-4 w-4" />
          설문 중단
        </Button>
      )}

      {/* 중단 문구 — 프리필: 기존 pausedMessage 또는 기본 안내 문구 */}
      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>설문을 중단합니다</DialogTitle>
            <DialogDescription>
              중단하는 동안 응답자 화면에는 아래 안내 문구만 표시되고 신규 응답 접수가 막힙니다.
              언제든 다시 재개할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pauseMessage}
            onChange={(e) => setPauseMessage(e.target.value)}
            placeholder={DEFAULT_PAUSED_MESSAGE}
            className="min-h-[120px]"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setPauseDialogOpen(false)}
            >
              취소
            </Button>
            <Button type="button" size="sm" disabled={isPending} onClick={pauseSurvey}>
              설문 중단
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 재개 확인 */}
      <AlertDialog open={resumeConfirmOpen} onOpenChange={setResumeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>설문을 재개할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              재개하면 응답자가 다시 설문에 응답할 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 다이얼로그를 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                resumeSurvey();
              }}
            >
              재개
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
