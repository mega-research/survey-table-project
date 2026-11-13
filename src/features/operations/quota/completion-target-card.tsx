'use client';

import { useId, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/lib/get-error-message';
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
 * 쿼터 설정 화면 맨 위의 「전체 완료 목표」 — 조건과 관계없이 설문 전체 완료 수가 목표에 닿으면
 * 응답을 닫는다(CONTEXT.md 「전체 완료 목표」). 아래 쿼터 플랜(셀별 목표)과 저장이 따로다:
 * 쿼터는 `quota_config`, 이것은 `max_responses` 라 이 카드의 「목표 저장」이 바로 적용한다.
 * 저장 즉시 적용되는 라이브 설정이고(재배포 없음) 빌더는 이 값을 쓰지 않는다.
 */
export function CompletionTargetCard({ surveyId, initialTarget, completedCount }: Props) {
  const router = useRouter();
  const headingId = useId();
  const hintId = useId();
  const [target, setTarget] = useState(initialTarget);
  const [text, setText] = useState(initialTarget !== null ? String(initialTarget) : '');
  const [isPending, startTransition] = useTransition();

  const reached = target !== null && completedCount >= target;
  const parsed = parseCompletionTarget(text);
  const invalid = text.trim() !== '' && parsed === null;
  const changed = parsed !== target;
  const closesNow = parsed !== null && changed && completedCount >= parsed;

  const save = (next: number | null) =>
    startTransition(async () => {
      try {
        const result = await client.operations.control.setCompletionTarget({
          surveyId,
          completionTarget: next,
        });
        setTarget(result.completionTarget);
        setText(result.completionTarget !== null ? String(result.completionTarget) : '');
        toast.success(
          result.completionTarget === null
            ? '전체 완료 목표를 해제했습니다.'
            : `전체 완료 목표를 ${result.completionTarget.toLocaleString()}건으로 저장했습니다.`,
        );
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '전체 완료 목표 저장에 실패했습니다.'));
      }
    });

  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h3 id={headingId} className="text-sm font-medium text-slate-700">
            전체 완료 목표{' '}
            <span
              className={
                target === null
                  ? 'text-slate-400'
                  : reached
                    ? 'font-semibold text-rose-600'
                    : 'font-semibold text-blue-600'
              }
            >
              {target === null ? '없음' : `${target.toLocaleString()}건`}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            조건과 관계없이 설문 전체의 완료 응답이 이 수에 닿으면 응답을 닫습니다. 새 응답자는
            들어오지 못하고, 응답 중이던 사람은 쿼터마감으로 끝납니다(답변은 저장). 안내는 아래
            마감 안내 문구를 씁니다. 저장하는 즉시 적용됩니다.
          </p>
          <p className="mt-2 text-xs text-slate-600 tabular-nums">
            현재 완료 {completedCount.toLocaleString()}건
            {target !== null &&
              (reached ? (
                <span className="font-medium text-rose-600">
                  {' '}
                  · 목표에 도달해 응답이 닫혀 있습니다
                </span>
              ) : (
                ` · 목표까지 ${(target - completedCount).toLocaleString()}건 남음`
              ))}
          </p>
        </div>

        <form
          className="flex flex-col items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed !== null && changed) save(parsed);
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              aria-labelledby={headingId}
              aria-describedby={invalid || closesNow ? hintId : undefined}
              aria-invalid={invalid || undefined}
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 1100"
              className="w-28 text-right tabular-nums"
            />
            <span className="text-sm text-slate-500">건</span>
            <Button type="submit" disabled={isPending || parsed === null || !changed}>
              {isPending ? '저장 중…' : '목표 저장'}
            </Button>
            {target !== null && (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => save(null)}
              >
                해제
              </Button>
            )}
          </div>
          {(invalid || closesNow) && (
            <p id={hintId} className="text-xs text-rose-600">
              {invalid
                ? '1 이상의 정수를 입력하세요.'
                : '현재 완료 수 이하입니다. 저장하는 즉시 응답이 닫힙니다.'}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
