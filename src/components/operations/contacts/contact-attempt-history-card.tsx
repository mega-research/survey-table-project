'use client';

import { useTransition } from 'react';

import { deleteContactAttempt } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import type { ContactResultCode } from '@/db/schema/schema-types';
import type { ContactAttemptRow } from '@/lib/operations/contacts.server';

interface ContactAttemptHistoryCardProps {
  contactTargetId: string;
  surveyId: string;
  attempts: ContactAttemptRow[];
  resultCodes: ContactResultCode[];
}

const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const TONE_CLASS: Record<NonNullable<ContactResultCode['tone']>, string> = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  blue: 'bg-blue-100 text-blue-700',
  slate: 'bg-slate-100 text-slate-700',
};

export function ContactAttemptHistoryCard({
  contactTargetId,
  surveyId,
  attempts,
  resultCodes,
}: ContactAttemptHistoryCardProps) {
  const [isPending, startTransition] = useTransition();

  const codeLookup = new Map(resultCodes.map((c) => [c.code, c]));

  function remove(id: string) {
    if (!window.confirm('이 회차 기록을 삭제하시겠습니까?')) return;
    startTransition(async () => {
      try {
        await deleteContactAttempt(surveyId, contactTargetId, id);
      } catch (e) {
        window.alert((e as Error).message);
      }
    });
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-base font-semibold">컨택결과 (최근순)</h3>
        <span className="text-xs text-slate-400">{attempts.length}건</span>
      </div>
      <div>
        {attempts.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-400">아직 회차 기록이 없습니다.</div>
        ) : (
          attempts.map((a) => {
            const meta = codeLookup.get(a.resultCode);
            const tone = meta?.tone ?? 'slate';
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 border-t px-5 py-3 text-sm first:border-t-0"
              >
                <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">
                  {dateFmt.format(a.createdAt)}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[tone]}`}>
                      [{a.attemptNo}] {meta?.label ?? a.resultCode}
                    </span>
                  </div>
                  {a.note && <div className="mt-1 text-xs text-slate-600">{a.note}</div>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  className="text-red-600"
                  onClick={() => remove(a.id)}
                >
                  삭제
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
