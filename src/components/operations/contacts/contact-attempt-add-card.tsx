'use client';

import { useState, useTransition } from 'react';

import { addContactAttempt } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import type { ContactResultCode } from '@/db/schema/schema-types';

interface ContactAttemptAddCardProps {
  contactTargetId: string;
  surveyId: string;
  resultCodes: ContactResultCode[];
}

export function ContactAttemptAddCard({
  contactTargetId,
  surveyId,
  resultCodes,
}: ContactAttemptAddCardProps) {
  const [resultCode, setResultCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add() {
    if (!resultCode) {
      setError('결과코드를 선택하세요.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addContactAttempt({
          contactTargetId,
          surveyId,
          resultCode,
          note: note || undefined,
        });
        setResultCode(null);
        setNote('');
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b bg-red-50 px-5 py-3">
        <h3 className="text-base font-semibold text-red-700">컨택결과 추가</h3>
      </div>
      <div className="px-5 py-4">
        {error && (
          <div role="alert" className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {resultCodes
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <label
                key={c.code}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
                  resultCode === c.code ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={resultCode === c.code}
                  onChange={() => setResultCode(c.code)}
                />
                <span className="truncate">{c.label}</span>
              </label>
            ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모할 사항을 입력해주세요."
          rows={2}
          className="mt-3 w-full rounded border px-2 py-1.5 text-sm"
        />

        <Button onClick={add} disabled={isPending} className="mt-2 w-full justify-center">
          {isPending ? '추가 중…' : '+ 컨택결과 추가'}
        </Button>
      </div>
    </div>
  );
}
