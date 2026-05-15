'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { deleteContactAttempt } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import type { ContactResultCode } from '@/db/schema/schema-types';
import { useAutoFadeMessage } from '@/hooks/use-auto-fade-message';
import { formatLocalMonthDayTime } from '@/lib/date-formatters';
import { resultCodeToneClass } from '@/lib/operations/contacts-shared';
import type { ContactAttemptRow } from '@/lib/operations/contacts.server';

interface ContactAttemptHistoryCardProps {
  contactTargetId: string;
  surveyId: string;
  attempts: ContactAttemptRow[];
  resultCodes: ContactResultCode[];
}

export function ContactAttemptHistoryCard({
  contactTargetId,
  surveyId,
  attempts,
  resultCodes,
}: ContactAttemptHistoryCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useAutoFadeMessage();

  const codeLookup = new Map(resultCodes.map((c) => [c.code, c]));

  function remove(id: string) {
    if (!window.confirm('이 회차 기록을 삭제하시겠습니까?')) return;
    startTransition(async () => {
      try {
        await deleteContactAttempt(surveyId, contactTargetId, id);
        router.refresh();
        setSuccessMessage('회차 삭제 완료');
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
      {successMessage && (
        <div
          role="status"
          className="mx-5 mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700"
        >
          {successMessage}
        </div>
      )}
      <div>
        {attempts.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-400">아직 회차 기록이 없습니다.</div>
        ) : (
          attempts.map((a) => {
            const meta = codeLookup.get(a.resultCode);
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 border-t px-5 py-3 text-sm first:border-t-0"
              >
                <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">
                  {formatLocalMonthDayTime(a.createdAt)}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${resultCodeToneClass(meta?.tone)}`}>
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
