'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { resultErrorMessage } from '@/lib/get-error-message';
import type { ScaleMeanCandidate } from '@/lib/operations/scale-mean-format';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  candidates: ScaleMeanCandidate[];
  onSaved?: () => void;
  onCancel?: () => void;
}

/**
 * 척도 평균 「문항 선택」 (CONTEXT.md 「척도 평균」) — 켜면 척도 줄이 생기는 문항 목록.
 * 저장은 고른 집합 전체를 보낸다(나머지는 꺼진다). 켜고 끄는 곳은 여기 하나다 — 빌더는 보이기만 한다.
 */
export function ScaleMeanQuestionPicker({ surveyId, candidates, onSaved, onCancel }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(candidates.filter((c) => c.enabled).map((c) => c.questionId)),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const changed = candidates.some((c) => c.enabled !== selected.has(c.questionId));

  const toggle = (questionId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await client.operations.scaleMean.setQuestions({
          surveyId,
          questionIds: candidates
            .filter((c) => selected.has(c.questionId))
            .map((c) => c.questionId),
        });
        if (!result.ok) {
          setError(resultErrorMessage(result.error, '저장에 실패했습니다.'));
          return;
        }
        router.refresh();
        onSaved?.();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {selected.size}개 선택 · 전체 {candidates.length}개
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(candidates.map((c) => c.questionId)))}
          >
            전체 선택
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            전체 해제
          </Button>
        </div>
      </div>

      <ul className="max-h-[420px] divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 bg-white">
        {candidates.map((c) => {
          const id = `scale-mean-pick-${c.questionId}`;
          return (
            <li key={c.questionId}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <Checkbox
                  id={id}
                  checked={selected.has(c.questionId)}
                  onCheckedChange={(checked) => toggle(c.questionId, checked === true)}
                  aria-label={`${c.code} ${c.title}`}
                />
                <span className="w-16 shrink-0 font-semibold text-gray-900">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-gray-700" title={c.title}>
                  {c.title}
                </span>
                {c.rowCount > 1 && (
                  <span className="shrink-0 text-xs text-gray-500">행 {c.rowCount}개</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {error && (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            취소
          </Button>
        )}
        <Button type="button" onClick={save} disabled={!changed || isPending}>
          {isPending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
