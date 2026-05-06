'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

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
  const [localScheme, setLocalScheme] = useState<ContactColumnScheme>(scheme);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const initialAttrs = useMemo(() => initial?.attrs ?? {}, [initial]);
  const initialMemo = initial?.memo ?? null;
  const initialContactMethod = initial?.contactMethod ?? null;

  const isDirty = useMemo(() => {
    if (!isEdit) {
      // 신규 모드: 사용자가 attrs/memo/contactMethod 중 하나라도 입력했으면 dirty.
      const hasAttr = Object.values(attrs).some((v) => v && v.trim().length > 0);
      const hasMemo = (memo ?? '').trim().length > 0;
      const hasMethod = contactMethod != null;
      return hasAttr || hasMemo || hasMethod;
    }
    // 편집 모드: initial 과 비교
    if (!shallowEqualRecord(attrs, initialAttrs)) return true;
    if ((memo ?? '') !== (initialMemo ?? '')) return true;
    if (contactMethod !== initialContactMethod) return true;
    if (!schemeEqual(localScheme, scheme)) return true;
    return false;
  }, [
    isEdit,
    attrs,
    memo,
    contactMethod,
    localScheme,
    initialAttrs,
    initialMemo,
    initialContactMethod,
    scheme,
  ]);

  // beforeunload 보호 — dirty 상태에서 탭 닫기/새로고침 시 경고
  useEffect(() => {
    if (!isDirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome/Edge 는 returnValue 를 요구
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  function confirmIfDirty(): boolean {
    if (!isDirty) return true;
    return window.confirm('변경사항이 저장되지 않았습니다. 나가시겠습니까?');
  }

  function onColumnToggle(attrsKey: string, hidden: boolean) {
    // I2: 즉시 server 호출 폐기 — localScheme 만 갱신, 저장 시점에 반영
    setLocalScheme((prev) => ({
      ...prev,
      columns: prev.columns.map((c) =>
        c.source === `attrs.${attrsKey}` ? { ...c, hidden } : c,
      ),
    }));
  }

  function remove() {
    if (!isEdit || !initial) return;
    if (!window.confirm('이 컨택을 삭제하시겠습니까? (응답이 있으면 응답은 보존, 매칭만 끊김)')) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteContactTarget(surveyId, initial.id);
        // 삭제 후엔 dirty 무시 → router.push 직접
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
        // I2: localScheme 이 prop scheme 과 다르면 컬럼 스킴도 함께 저장
        if (isEdit && !schemeEqual(localScheme, scheme)) {
          await updateContactColumns(surveyId, localScheme);
        }
        // 저장 성공 → dirty reset (initial 동기화 효과를 위해 router.refresh)
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function goList() {
    if (!confirmIfDirty()) return;
    router.push(`/admin/surveys/${surveyId}/operations/contacts`);
  }

  // I8: systemFieldKeys 자동 감지 실패 시 안내 banner
  const systemFieldsMissing =
    !systemFieldKeys ||
    (!systemFieldKeys.group && !systemFieldKeys.email && !systemFieldKeys.biz);

  return (
    <div className="space-y-4">
      {systemFieldsMissing && (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          시스템 필드 (그룹/이메일/사업자번호) 가 자동 감지되지 않았습니다. 검색·마스킹·머지
          기능이 제한될 수 있습니다.
        </div>
      )}
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <ContactInfoCard
            surveyId={surveyId}
            resid={initial?.resid ?? null}
            scheme={localScheme}
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
            <Button variant="outline" onClick={goList}>
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function shallowEqualRecord(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  }
  return true;
}

function schemeEqual(a: ContactColumnScheme, b: ContactColumnScheme): boolean {
  if (a.columns.length !== b.columns.length) return false;
  for (let i = 0; i < a.columns.length; i++) {
    const ac = a.columns[i];
    const bc = b.columns[i];
    if (
      ac.key !== bc.key ||
      ac.source !== bc.source ||
      ac.label !== bc.label ||
      ac.order !== bc.order ||
      Boolean(ac.hidden) !== Boolean(bc.hidden)
    ) {
      return false;
    }
  }
  return true;
}
