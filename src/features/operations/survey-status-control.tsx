'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { ChevronDown, CircleDot, CirclePause, CircleStop, PencilLine } from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';
import { DEFAULT_PAUSED_MESSAGE } from '@/shared/lib/survey-control';

import { ToggleMenuItem, useHoverMenu } from './hover-toggle-menu';

interface Props {
  surveyId: string;
  initial: { isPaused: boolean; pausedMessage: string | null; isClosed: boolean };
}

/**
 * 운영 헤더의 설문 중단·종료 메뉴 (ADR-0030).
 *
 * 테스트 모드처럼 버튼은 메뉴만 열고 바꾸는 일은 메뉴 안 토글이 한다. 버튼 이름이 지금 상태를
 * 말한다 — 설문 중 · 설문 중단(rose) · 설문 종료(slate). 두 축은 독립이라 함께 켜질 수 있고,
 * 그때 버튼은 더 넓게 닫는 종료를 앞세우고 「중단」 표식을 곁에 단다.
 *
 * 뜻이 다르다는 것은 토글 안내와 확인 창이 말한다. 중단은 「잠깐 멈춤」이라 응답자에게 보일
 * 문구를 받고, 종료는 「조사가 끝나 외부를 닫는다」라 문구 대신 **무엇이 바뀌는지**를 묻는다
 * — 「진행 중 응답은 제출된다」와 「메일은 계속 나간다」는 이름에서 짐작할 수 없다.
 *
 * 다른 탭에서 바뀐 상태를 따라가지 않는다 — 헤더 폴링은 테스트 모드만 동기화한다.
 */
export function SurveyStatusControl({ surveyId, initial }: Props) {
  const router = useRouter();
  const menu = useHoverMenu();
  const [isPaused, setIsPaused] = useState(initial.isPaused);
  const [pausedMessage, setPausedMessage] = useState(initial.pausedMessage);
  const [isClosed, setIsClosed] = useState(initial.isClosed);
  const [isPending, startTransition] = useTransition();
  /** 중단 문구 창 — 'pause' 는 새로 중단, 'edit' 은 중단 중 문구만 바꾼다. */
  const [messageDialog, setMessageDialog] = useState<'pause' | 'edit' | null>(null);
  const [messageDraft, setMessageDraft] = useState(initial.pausedMessage ?? DEFAULT_PAUSED_MESSAGE);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const openMessageDialog = (mode: 'pause' | 'edit') => {
    menu.setOpen(false);
    setMessageDraft(pausedMessage ?? DEFAULT_PAUSED_MESSAGE);
    setMessageDialog(mode);
  };

  const submitPause = () => {
    const nextMessage = messageDraft.trim() || DEFAULT_PAUSED_MESSAGE;
    const editing = messageDialog === 'edit';
    startTransition(async () => {
      try {
        const result = await client.operations.control.setPaused({
          surveyId,
          isPaused: true,
          pausedMessage: nextMessage,
        });
        setIsPaused(result.isPaused);
        setPausedMessage(result.pausedMessage);
        setMessageDialog(null);
        toast.success(editing ? '중단 안내 문구를 바꿨습니다.' : '설문을 중단했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(
          getErrorMessage(err, editing ? '문구를 바꾸지 못했습니다.' : '설문 중단에 실패했습니다.'),
        );
      }
    });
  };

  const resume = () =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setPaused({ surveyId, isPaused: false });
        setIsPaused(result.isPaused);
        setPausedMessage(result.pausedMessage);
        setResumeConfirmOpen(false);
        toast.success('설문을 재개했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '설문 재개에 실패했습니다.'));
      }
    });

  const applyClosed = (next: boolean) =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setClosed({ surveyId, isClosed: next });
        setIsClosed(result.isClosed);
        setCloseConfirmOpen(false);
        toast.success(next ? '설문을 종료했습니다.' : '설문 종료를 취소했습니다.');
        router.refresh();
      } catch (err) {
        toast.error(
          getErrorMessage(err, next ? '설문 종료에 실패했습니다.' : '종료 취소에 실패했습니다.'),
        );
      }
    });

  const buttonTone = isClosed
    ? 'border-slate-400 bg-slate-100 text-slate-700 hover:bg-slate-200'
    : isPaused
      ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : undefined;
  const ButtonIcon = isClosed ? CircleStop : isPaused ? CirclePause : CircleDot;

  return (
    <>
      <DropdownMenu open={menu.open} onOpenChange={menu.setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            {...menu.triggerProps}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            className={buttonTone}
          >
            <ButtonIcon className="mr-2 h-4 w-4" />
            {isClosed ? '설문 종료' : isPaused ? '설문 중단' : '설문 중'}
            {isClosed && isPaused ? (
              <span className="ml-2 rounded bg-rose-500 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white">
                중단
              </span>
            ) : null}
            <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px]" {...menu.contentProps}>
          <ToggleMenuItem
            icon={<CirclePause className="h-4 w-4" />}
            label="설문 중단"
            hint={
              isPaused
                ? '응답자에게 안내 문구만 보이는 중 · 끄면 재개합니다'
                : '잠깐 멈춤 — 응답자에게 안내 문구만 보이고 응답을 막습니다'
            }
            checked={isPaused}
            disabled={isPending}
            tone="rose"
            onToggle={() => {
              if (isPaused) {
                menu.setOpen(false);
                setResumeConfirmOpen(true);
              } else {
                openMessageDialog('pause');
              }
            }}
          />
          {isPaused && (
            <DropdownMenuItem disabled={isPending} onSelect={() => openMessageDialog('edit')}>
              <PencilLine className="mr-2 h-4 w-4" />
              중단 안내 문구 수정
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <ToggleMenuItem
            icon={<CircleStop className="h-4 w-4" />}
            label="설문 종료"
            hint={
              isClosed
                ? '새 응답과 외부 링크를 닫은 상태 · 끄면 종료를 취소합니다'
                : '조사 끝 — 새 응답과 외주·클라이언트 링크를 닫습니다'
            }
            checked={isClosed}
            disabled={isPending}
            tone="slate"
            onToggle={() => {
              menu.setOpen(false);
              setCloseConfirmOpen(true);
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 중단 문구 — 프리필: 기존 pausedMessage 또는 기본 안내 문구 */}
      <Dialog open={messageDialog !== null} onOpenChange={(o) => !o && setMessageDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {messageDialog === 'edit' ? '중단 안내 문구를 바꿉니다' : '설문을 중단합니다'}
            </DialogTitle>
            <DialogDescription>
              중단하는 동안 응답자 화면에는 아래 안내 문구만 표시되고 신규 응답 접수가 막힙니다.
              언제든 다시 재개할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            placeholder={DEFAULT_PAUSED_MESSAGE}
            className="min-h-[120px]"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setMessageDialog(null)}
            >
              취소
            </Button>
            <Button type="button" size="sm" disabled={isPending} onClick={submitPause}>
              {messageDialog === 'edit' ? '문구 저장' : '설문 중단'}
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
              {isClosed
                ? '중단을 풀어도 설문이 종료돼 있어 새 응답은 받지 않습니다. 진행 중인 응답은 다시 이어집니다.'
                : '재개하면 응답자가 다시 설문에 응답할 수 있습니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
            {/* preventDefault: Radix Action 의 자동 닫힘을 막아 실패 시 다이얼로그를 유지한다 */}
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                resume();
              }}
            >
              재개
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 종료·종료 취소 확인 */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
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
                applyClosed(!isClosed);
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
