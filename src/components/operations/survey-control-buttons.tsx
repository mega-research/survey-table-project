'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { CirclePause, CirclePlay, Copy, FlaskConical } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';

interface Props {
  surveyId: string;
  initial: {
    isPaused: boolean;
    pausedMessage: string | null;
    testModeEnabled: boolean;
    testToken: string | null;
  };
}

/**
 * 운영 헤더의 설문 중단·테스트 모드 토글 버튼.
 *
 * - 테스트 모드: 응답 페이지가 `?test=<token>` 링크로 접근됐을 때 중단/중복 게이트를 우회하고
 *   `survey_responses.isTest=true` 로 적재되게 만든다(집계 제외). ON 이면 amber 톤 드롭다운으로
 *   링크 복사/끄기를 제공한다.
 * - 중단: 응답자 화면에 안내 문구만 노출하고 신규 응답 접수를 막는다. ON 이면 rose 톤으로
 *   "중단 중" 을 표시하고 클릭 시 재개 확인을 받는다.
 *
 * 테스트 링크는 `/survey/{surveyId}?test={token}` 형식 — 컨택 초대 링크(`CopyInviteUrlButton`,
 * `campaign-dispatch.ts`)와 동일하게 slug 대신 surveyId 를 직접 사용한다. 응답 페이지의 식별자
 * 파서(`use-survey-loader.ts`)는 UUID 형태면 slug/privateToken 조회를 거치지 않고 surveyId 로
 * 바로 처리하므로, 비공개 설문이거나 슬러그가 없는 설문에서도 항상 유효하다.
 */
export function SurveyControlButtons({ surveyId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const [testOffConfirm, setTestOffConfirm] = useState<{ count: number } | null>(null);
  const [pauseMessage, setPauseMessage] = useState(
    initial.pausedMessage ?? DEFAULT_PAUSED_MESSAGE,
  );

  const testLink =
    typeof window !== 'undefined' && state.testToken
      ? `${window.location.origin}/survey/${surveyId}?test=${state.testToken}`
      : null;

  // --- 테스트 모드 ---
  const enableTestMode = () =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setTestMode({ surveyId, enabled: true });
        setState((s) => ({ ...s, ...result }));
        toast.success('테스트 모드가 켜졌습니다. 테스트 링크를 복사해 사용하세요.');
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '테스트 모드 전환에 실패했습니다.'));
      }
    });

  const requestDisableTestMode = () =>
    startTransition(async () => {
      try {
        const { testResponseCount } = await client.operations.control.get({ surveyId });
        if (testResponseCount > 0) {
          setTestOffConfirm({ count: testResponseCount });
        } else {
          await disableTestMode(false);
        }
      } catch (err) {
        toast.error(getErrorMessage(err, '테스트 모드 상태 조회에 실패했습니다.'));
      }
    });

  const disableTestMode = (deleteResponses: boolean) =>
    startTransition(async () => {
      try {
        if (deleteResponses) {
          const { deletedCount } = await client.operations.control.deleteTestResponses({
            surveyId,
          });
          toast.success(`테스트 응답 ${deletedCount}건을 삭제했습니다.`);
        }
        const result = await client.operations.control.setTestMode({ surveyId, enabled: false });
        setState((s) => ({ ...s, ...result }));
        setTestOffConfirm(null);
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '테스트 모드 전환에 실패했습니다.'));
      }
    });

  const copyTestLink = async () => {
    if (!testLink) return;
    try {
      await navigator.clipboard.writeText(testLink);
      toast.success('테스트 링크를 복사했습니다.');
    } catch (err) {
      toast.error(getErrorMessage(err, '클립보드 복사에 실패했습니다.'));
    }
  };

  // --- 중단 모드 ---
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
      {state.testModeEnabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              테스트 모드
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!testLink} onSelect={copyTestLink}>
              <Copy className="mr-2 h-4 w-4" />
              테스트 링크 복사
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isPending} onSelect={requestDisableTestMode}>
              테스트 모드 끄기
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={enableTestMode}
        >
          <FlaskConical className="mr-2 h-4 w-4" />
          테스트 모드
        </Button>
      )}

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

      {/* 테스트 모드 끄기 확인 — 삭제되지 않은 테스트 응답이 있을 때만 뜬다 */}
      <AlertDialog
        open={testOffConfirm !== null}
        onOpenChange={(open) => !open && setTestOffConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>테스트 응답 {testOffConfirm?.count}건을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              테스트 모드에서 수집된 응답은 통계·집계에서 항상 제외됩니다. 삭제하면 복구할 수
              없으니, 보관하려면 &ldquo;보관하고 끄기&rdquo;를 선택하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => disableTestMode(false)}
            >
              보관하고 끄기
            </Button>
            <AlertDialogAction disabled={isPending} onClick={() => disableTestMode(true)}>
              삭제 후 끄기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <AlertDialogAction disabled={isPending} onClick={resumeSurvey}>
              재개
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
