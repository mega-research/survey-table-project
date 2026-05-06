'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  addContactTarget,
  deleteContactTarget,
  updateContactColumns,
  updateContactTarget,
} from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import { ContactAttemptAddCard } from '@/components/operations/contacts/contact-attempt-add-card';
import { ContactAttemptHistoryCard } from '@/components/operations/contacts/contact-attempt-history-card';
import { ContactInfoCard } from '@/components/operations/contacts/contact-info-card';
import type {
  ContactColumnScheme,
  ContactMethod,
  ContactResultCode,
} from '@/db/schema/schema-types';
import type { ContactAttemptRow } from '@/lib/operations/contacts.server';

interface ContactDetailFormProps {
  surveyId: string;
  scheme: ContactColumnScheme;
  resultCodes: ContactResultCode[];
  systemFieldKeys?: { group?: string; email?: string; biz?: string };
  /** 편집 모드: 기존 컨택 정보. 신규 모드: undefined. */
  initial?: {
    id: string;
    resid: number;
    attrs: Record<string, string>;
    memo: string | null;
    contactMethod: ContactMethod | null;
    respondedAt: Date | null;
    inviteToken: string;
    attempts: ContactAttemptRow[];
  };
}

export function ContactDetailForm({
  surveyId,
  scheme,
  resultCodes,
  systemFieldKeys,
  initial,
}: ContactDetailFormProps) {
  const router = useRouter();
  const isEdit = initial != null;

  const [attrs, setAttrs] = useState<Record<string, string>>(initial?.attrs ?? {});
  const [memo, setMemo] = useState<string | null>(initial?.memo ?? null);
  const [contactMethod, setContactMethod] = useState<ContactMethod | null>(
    initial?.contactMethod ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onColumnToggle(attrsKey: string, hidden: boolean) {
    const updated: ContactColumnScheme = {
      ...scheme,
      columns: scheme.columns.map((c) =>
        c.source === `attrs.${attrsKey}` ? { ...c, hidden } : c,
      ),
    };
    startTransition(async () => {
      try {
        await updateContactColumns(surveyId, updated);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function remove() {
    if (!isEdit || !initial) return;
    if (!window.confirm('이 컨택을 삭제하시겠습니까? (응답이 있으면 응답은 보존, 매칭만 끊김)')) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteContactTarget(surveyId, initial.id);
        router.push(`/admin/surveys/${surveyId}/operations/contacts`);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (isEdit && initial) {
          await updateContactTarget({
            id: initial.id,
            surveyId,
            attrs,
            memo,
            contactMethod,
            systemFieldKeys,
          });
        } else {
          await addContactTarget({
            surveyId,
            attrs,
            memo,
            contactMethod,
            systemFieldKeys,
          });
        }
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <ContactInfoCard
            resid={initial?.resid ?? null}
            scheme={scheme}
            attrs={attrs}
            memo={memo}
            contactMethod={contactMethod}
            respondedAt={initial?.respondedAt ?? null}
            inviteToken={initial?.inviteToken ?? null}
            onColumnToggle={isEdit ? onColumnToggle : undefined}
            onAttrsChange={setAttrs}
            onMemoChange={(m) => setMemo(m)}
            onContactMethodChange={setContactMethod}
          />
          <div className="mt-2 flex gap-2 rounded-lg border bg-slate-50 px-4 py-3">
            <Button
              variant="outline"
              onClick={() => router.push(`/admin/surveys/${surveyId}/operations/contacts`)}
            >
              목록
            </Button>
            {isEdit && (
              <Button
                variant="outline"
                onClick={remove}
                disabled={isPending}
                className="text-red-600 hover:text-red-700"
              >
                삭제
              </Button>
            )}
            <span className="flex-1" />
            <Button onClick={save} disabled={isPending}>
              {isPending ? '저장 중…' : '💾 저장'}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {isEdit && initial ? (
            <>
              <ContactAttemptAddCard
                contactTargetId={initial.id}
                surveyId={surveyId}
                resultCodes={resultCodes}
              />
              <ContactAttemptHistoryCard
                contactTargetId={initial.id}
                surveyId={surveyId}
                attempts={initial.attempts}
                resultCodes={resultCodes}
              />
            </>
          ) : (
            <div className="rounded-lg border bg-slate-50 p-5 text-sm text-slate-500">
              컨택을 먼저 저장하면 회차 기록을 추가할 수 있습니다.
            </div>
          )}

          {/* 후속 슬라이스 placeholders */}
          <div className="rounded-lg border bg-white">
            <div className="flex items-center justify-between px-5 py-3 text-sm text-slate-500">
              <span>이메일 발송 현황 ▾</span>
              <span className="text-xs">후속 슬라이스</span>
            </div>
          </div>
          <div className="rounded-lg border bg-white">
            <div className="flex items-center justify-between px-5 py-3 text-sm text-slate-500">
              <span>수정 / 편집 현황 ▾</span>
              <span className="text-xs">후속 슬라이스</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
