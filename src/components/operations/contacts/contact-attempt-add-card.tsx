'use client';

import { useRouter } from 'next/navigation';
import { forwardRef, useImperativeHandle, useState, useTransition } from 'react';

import { addContactAttempt } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import type { ContactResultCode } from '@/db/schema/schema-types';
import { useAutoFadeMessage } from '@/hooks/use-auto-fade-message';

interface ContactAttemptAddCardProps {
  contactTargetId: string;
  surveyId: string;
  resultCodes: ContactResultCode[];
}

/**
 * 부모 컴포넌트 ContactDetailForm 의 메인 저장 동작에서 호출 가능한 imperative handle.
 *
 * - flushIfSelected: 라디오 선택돼 있으면 회차 추가, 아니면 no-op.
 *   부모 save 흐름 안에서 await 가능 자체 startTransition 안 씀, 부모 transition 안에서 직렬.
 */
export interface ContactAttemptAddCardHandle {
  flushIfSelected: () => Promise<void>;
}

export const ContactAttemptAddCard = forwardRef<
  ContactAttemptAddCardHandle,
  ContactAttemptAddCardProps
>(function ContactAttemptAddCard(
  { contactTargetId, surveyId, resultCodes },
  ref,
) {
  const router = useRouter();
  const [resultCode, setResultCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useAutoFadeMessage();
  const [isPending, startTransition] = useTransition();

  // 실제 server action 호출 + state reset. 자체 add() 와 flushIfSelected 양쪽에서 호출.
  async function performAdd(): Promise<void> {
    if (!resultCode) return; // imperative 호출 시 라디오 없으면 silent no-op
    setError(null);
    try {
      await addContactAttempt({
        contactTargetId,
        surveyId,
        resultCode,
        note: note || undefined,
      });
      router.refresh();
      setResultCode(null);
      setNote('');
      setSuccessMessage('회차 추가 완료');
    } catch (e) {
      setError((e as Error).message);
      throw e; // 부모 save 의 try/catch 에서도 잡히게
    }
  }

  // 자체 "+ 회차 결과 추가" 버튼 — 라디오 선택 안 됐으면 명시 에러 표시
  function add() {
    if (!resultCode) {
      setError('결과코드를 선택하세요.');
      return;
    }
    startTransition(async () => {
      try {
        await performAdd();
      } catch {
        // performAdd 가 이미 setError 처리. 부모 호출이 아니므로 rethrow 무시.
      }
    });
  }

  // 부모 메인 저장이 호출. closure 가 최신 resultCode/note 참조하도록 deps 명시.
  useImperativeHandle(
    ref,
    () => ({ flushIfSelected: performAdd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultCode, note, contactTargetId, surveyId],
  );

  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b bg-red-50 px-5 py-3">
        <h3 className="text-base font-semibold text-red-700">회차 결과 추가</h3>
      </div>
      <div className="px-5 py-4">
        {error && (
          <div role="alert" className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {successMessage && (
          <div
            role="status"
            className="mb-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700"
          >
            {successMessage}
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
          {isPending ? '추가 중…' : '+ 회차 결과 추가'}
        </Button>
      </div>
    </div>
  );
});
