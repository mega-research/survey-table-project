'use client';

import { useId, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Target } from 'lucide-react';
import { toast } from 'sonner';

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
import { cn } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  /** 전체 완료 목표 — null 이면 없음. */
  initialTarget: number | null;
  /** 실응답 완료 수(서버가 목표 판정과 같은 셈으로 센 값). 화면을 새로 그릴 때 갱신된다. */
  completedCount: number;
}

/** 입력 글자 → 목표. 빈 칸·1 미만·정수가 아닌 값은 null(저장 불가). */
export function parseCompletionTarget(text: string): number | null {
  const trimmed = text.replace(/,/g, '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000 ? value : null;
}

/**
 * 운영 헤더의 「완료 목표」 — 설문 전체 완료 수가 목표에 닿으면 응답을 닫는다
 * (CONTEXT.md 「전체 완료 목표」). 쿼터가 조건별 셀 목표라면 이것은 설문 전체 하나의 목표다.
 * 저장 즉시 적용되는 라이브 설정이고(재배포 없음) 빌더는 이 값을 쓰지 않는다.
 */
export function CompletionTargetControl({ surveyId, initialTarget, completedCount }: Props) {
  const router = useRouter();
  const inputId = useId();
  const [target, setTarget] = useState(initialTarget);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();

  const reached = target !== null && completedCount >= target;
  const parsed = parseCompletionTarget(text);
  const closesNow = parsed !== null && completedCount >= parsed;

  const openDialog = () => {
    setText(target !== null ? String(target) : '');
    setOpen(true);
  };

  const save = (next: number | null) =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setCompletionTarget({
          surveyId,
          completionTarget: next,
        });
        setTarget(result.completionTarget);
        setOpen(false);
        toast.success(
          result.completionTarget === null
            ? '완료 목표를 해제했습니다.'
            : `완료 목표를 ${result.completionTarget.toLocaleString()}건으로 저장했습니다.`,
        );
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '완료 목표 저장에 실패했습니다.'));
      }
    });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={openDialog}
        className={cn(
          'tabular-nums',
          reached && 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100',
        )}
      >
        <Target className="mr-2 h-4 w-4" />
        {target === null
          ? '완료 목표'
          : `${reached ? '목표 도달' : '완료'} ${completedCount.toLocaleString()} / ${target.toLocaleString()}`}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>전체 완료 목표</DialogTitle>
            <DialogDescription>
              완료 응답이 목표에 닿으면 새 응답자는 들어오지 못하고, 응답 중이던 사람은 다음
              페이지에서 모집 완료 안내를 봅니다. 저장하는 즉시 적용되며 다시 배포하지 않아도
              됩니다.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== null) save(parsed);
            }}
          >
            <Label htmlFor={inputId}>목표 완료 수</Label>
            <Input
              id={inputId}
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 1100"
              className="tabular-nums"
            />
            <p className="text-sm text-gray-500 tabular-nums">
              현재 완료 {completedCount.toLocaleString()}건
              {target !== null && ` · 지금 목표 ${target.toLocaleString()}건`}
            </p>
            {closesNow && (
              <p className="text-sm text-rose-600">
                현재 완료 수 이하입니다. 저장하는 즉시 응답이 마감됩니다.
              </p>
            )}
          </form>
          <DialogFooter>
            {target !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => save(null)}
                className="sm:mr-auto"
              >
                목표 해제
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || parsed === null}
              onClick={() => parsed !== null && save(parsed)}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
