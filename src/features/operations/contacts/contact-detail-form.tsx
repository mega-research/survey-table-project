'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  ContactAttemptAddCard,
  type ContactAttemptAddCardHandle,
} from '@/features/operations/contacts/contact-attempt-add-card';
import { ContactAttemptHistoryCard } from '@/features/operations/contacts/contact-attempt-history-card';
import { ContactEditHistoryCard } from '@/features/operations/contacts/contact-edit-history-card';
import { ContactInfoCard } from '@/features/operations/contacts/contact-info-card';
import { ContactMailHistoryCard } from '@/features/operations/contacts/contact-mail-history-card';
import { CopyInviteUrlButton } from '@/features/operations/contacts/copy-invite-url-button';
import {
  type MailTemplateOption,
  SendSingleMailDialog,
} from '@/features/operations/contacts/send-single-mail-dialog';
import { useAutoFadeMessage } from '@/features/operations/hooks/use-auto-fade-message';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import { piiKeyOf } from '@/lib/operations/contacts-format';
import type {
  ContactColumnScheme,
  ContactMethod,
  ContactResultCode,
} from '@/shared/contracts/contacts';
import type {
  ContactAttemptRow,
  MailHistoryRow,
  PiiUpdate,
  ResponseEditLogRow,
} from '@/shared/contracts/contacts-io';

import type { ContactDetailPermissions } from './contact-detail-permissions';
import { client } from '@/shared/lib/rpc';

import { operationsPaths } from '../operations-paths';

interface ContactDetailFormProps {
  surveyId: string;
  /** 이 콘솔의 주소 접두 — 저장·삭제 뒤 돌아갈 목록이 자기 트리 안이다. */
  basePath: string;
  scheme: ContactColumnScheme;
  resultCodes: ContactResultCode[];
  systemFieldKeys?: { group?: string };
  /** 편집 모드: 기존 조사 대상 정보. 신규 모드: undefined. */
  initial?: {
    id: string;
    resid: number;
    attrs: Record<string, string>;
    /** PII 컬럼별 복호화 결과 (columnKey → { fieldType, plain, failed }) — RLS 통과 사용자만 접근. */
    piiDecrypted?: Record<string, { fieldType: string; plain: string; failed: boolean }>;
    memo: string | null;
    contactMethod: ContactMethod | null;
    respondedAt: Date | null;
    /**
     * 대행 진입점이 될 초대 코드 — **null 이면 이 주체는 대신 누를 수 없다**.
     *
     * 원문 토큰(`inviteToken`)은 여기 없다. 이 화면이 쓰는 것은 짧은 링크를 만드는 코드
     * 하나이고, 쓰지도 않는 값을 payload 에 실으면 감추는 의미가 사라진다 — 판정은 서버
     * 투영(`ContactDetailScreen`)이 하고 여기는 받은 것만 그린다.
     */
    inviteCode: string | null;
    responseId: string | null;
    /** 수정 대상 응답이 재응답 허용 대상 상태인지 — 버튼 노출 판정 (respondedAt 링크 누락 대비). */
    responseReeditable?: boolean;
    attempts: ContactAttemptRow[];
  };
  /** 메일 발송 이력 (편집 모드에서만 의미, 신규 모드는 빈 배열). */
  mailHistory?: MailHistoryRow[];
  /** 응답 편집 audit 이력 (편집 모드에서만 의미). */
  editLogs?: ResponseEditLogRow[];
  /** 단건 메일 발송 다이얼로그용 (편집 모드에서만 의미). */
  mailSend?: { templates: MailTemplateOption[]; disabledReason: string | null };
  /**
   * 이 주체가 이 화면에서 무엇을 할 수 있는가 — 서버가 판정을 풀어 넘긴 것 (티켓 08).
   *
   * 클라이언트 컴포넌트라 capability 집합을 그대로 받을 수 없어 불리언 묶음으로 온다.
   * 푸는 자리는 `contactDetailPermissions` 한 곳이다.
   */
  permissions: ContactDetailPermissions;
}

export function ContactDetailForm({
  surveyId,
  basePath,
  scheme,
  resultCodes,
  systemFieldKeys,
  initial,
  mailHistory = [],
  editLogs = [],
  mailSend,
  permissions,
}: ContactDetailFormProps) {
  const router = useRouter();
  const isEdit = initial != null;

  const [attrs, setAttrs] = useState<Record<string, string>>(initial?.attrs ?? {});
  // PII 값 — columnKey → 평문. 초기값은 piiDecrypted 에서 플랫화 (failed 항목 제외).
  const initialPiiValues = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (initial?.piiDecrypted) {
      for (const [k, v] of Object.entries(initial.piiDecrypted)) {
        if (!v.failed) m[k] = v.plain;
      }
    }
    return m;
  }, [initial]);
  // 복호화 실패한 컬럼 set — 편집 금지 + 저장 시 skip 으로 cipher 덮어쓰기 방지.
  const failedPiiKeys = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    if (initial?.piiDecrypted) {
      for (const [k, v] of Object.entries(initial.piiDecrypted)) {
        if (v.failed) s.add(k);
      }
    }
    return s;
  }, [initial]);
  const [piiValues, setPiiValues] = useState<Record<string, string>>(initialPiiValues);
  const [memo, setMemo] = useState<string | null>(initial?.memo ?? null);
  const [contactMethod, setContactMethod] = useState<ContactMethod | null>(
    initial?.contactMethod ?? null,
  );
  const [localScheme, setLocalScheme] = useState<ContactColumnScheme>(scheme);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useAutoFadeMessage();
  const [isPending, startTransition] = useTransition();
  // 회차 추가 카드에 imperative 접근 — 메인 저장 시 라디오 선택돼 있으면 같이 flush.
  const attemptCardRef = useRef<ContactAttemptAddCardHandle>(null);

  const initialAttrs = useMemo(() => initial?.attrs ?? {}, [initial]);
  const initialMemo = initial?.memo ?? null;
  const initialContactMethod = initial?.contactMethod ?? null;

  const isDirty = useMemo(() => {
    if (!isEdit) {
      // 신규 모드: 사용자가 attrs/pii/memo/contactMethod 중 하나라도 입력했으면 dirty.
      const hasAttr = Object.values(attrs).some((v) => v && v.trim().length > 0);
      const hasPii = Object.values(piiValues).some((v) => v && v.trim().length > 0);
      const hasMemo = (memo ?? '').trim().length > 0;
      const hasMethod = contactMethod != null;
      return hasAttr || hasPii || hasMemo || hasMethod;
    }
    // 편집 모드: initial 과 비교
    if (!shallowEqualRecord(attrs, initialAttrs)) return true;
    if (!shallowEqualRecord(piiValues, initialPiiValues)) return true;
    if ((memo ?? '') !== (initialMemo ?? '')) return true;
    if (contactMethod !== initialContactMethod) return true;
    if (!schemeEqual(localScheme, scheme)) return true;
    return false;
  }, [
    isEdit,
    attrs,
    piiValues,
    memo,
    contactMethod,
    localScheme,
    initialAttrs,
    initialPiiValues,
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
      columns: prev.columns.map((c) => (c.source === `attrs.${attrsKey}` ? { ...c, hidden } : c)),
    }));
  }

  function remove() {
    if (!isEdit || !initial) return;
    if (
      !window.confirm('이 조사 대상을 삭제하시겠습니까? (응답이 있으면 응답은 보존, 매칭만 끊김)')
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        await client.contacts.targets.remove({ surveyId, id: initial.id });
        // 삭제 후엔 dirty 무시 → router.push 직접
        router.push(operationsPaths(basePath).contacts);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  /**
   * scheme.columns 에서 piiType + columnKey 를 추출. PII 값 변경분과 cross-reference 해
   * 액션에 보낼 PiiUpdate[] 빌드.
   */
  function buildPiiUpdates(): PiiUpdate[] {
    const updates: PiiUpdate[] = [];
    for (const col of scheme.columns) {
      if (!col.piiType) continue;
      const key = piiKeyOf(col.source);
      if (!key) continue;
      // 복호화 실패한 컬럼은 사용자가 수정 못 하므로 저장 대상 아님 — cipher 보존.
      if (failedPiiKeys.has(key)) continue;
      const next = piiValues[key] ?? '';
      const prev = initialPiiValues[key] ?? '';
      if (next === prev) continue; // 변경 없음 → skip
      updates.push({
        columnKey: key,
        fieldType: col.piiType as PiiFieldType,
        plain: next,
      });
    }
    return updates;
  }

  function save() {
    setError(null);
    const piiUpdates = buildPiiUpdates();
    // 빈 값으로 비운 PII 컬럼은 contact_pii 행이 DELETE 됨 — 복구 불가. confirm 요구.
    const willDeleteKeys: string[] = [];
    for (const u of piiUpdates) {
      if (!u.plain.trim()) {
        const col = scheme.columns.find((c) => piiKeyOf(c.source) === u.columnKey);
        willDeleteKeys.push(col?.label ?? u.columnKey);
      }
    }
    if (willDeleteKeys.length > 0) {
      const ok = window.confirm(
        `다음 암호화 컬럼이 비어 있어 영구 삭제됩니다 (복구 불가):\n\n· ${willDeleteKeys.join(
          '\n· ',
        )}\n\n계속하시겠습니까?`,
      );
      if (!ok) return;
    }
    const updatesForAction = piiUpdates.length > 0 ? piiUpdates : undefined;
    // React Compiler 는 try 본문의 conditional spread·논리연산·optional call 을 낮추지
    // 못한다. 페이로드 조각과 ref 스냅샷·편집 대상을 try 밖에서 확정해 두고 안에서는 값만 쓴다.
    const piiPatch = updatesForAction !== undefined ? { piiUpdates: updatesForAction } : {};
    const systemFieldsPatch = systemFieldKeys !== undefined ? { systemFieldKeys } : {};
    const editTarget = isEdit && initial ? initial : null;
    startTransition(async () => {
      try {
        if (editTarget && !permissions.manageContacts) {
          // **메모·연락 방법만 쓰는 좁은 표면**이다(`contacts.targets.setMemo`).
          // 형제 `update` 와 요구 capability 가 다른 것이 그 표면의 존재 이유이고
          // (writeAttempts ↔ manage), 여기서 `update` 를 부르면 외주가 명단 수정 권한을
          // 요구받아 거부당한다 — 화면은 메모만 고쳤는데 저장이 실패한다.
          await client.contacts.targets.setMemo({
            surveyId,
            id: editTarget.id,
            memo,
            contactMethod,
          });
          const attemptCard = attemptCardRef.current;
          if (attemptCard) await attemptCard.flushIfSelected();
          router.refresh();
          setSuccessMessage('저장 완료');
        } else if (editTarget) {
          await client.contacts.targets.update({
            id: editTarget.id,
            surveyId,
            attrs,
            ...piiPatch,
            memo,
            contactMethod,
            ...systemFieldsPatch,
          });
          // I2: localScheme 이 prop scheme 과 다르면 컬럼 스킴도 함께 저장
          if (!schemeEqual(localScheme, scheme)) {
            await client.contacts.columns.update({ surveyId, scheme: localScheme });
          }
          // 회차 라디오 선택돼 있으면 함께 추가 선택 안 됐으면 silent no-op.
          // ref 는 여기서 읽는다 — 위 await 구간에 카드가 언마운트되면 React 가 current 를
          // null 로 되돌리므로, 호이스트하면 stale 핸들로 RPC 가 나간다.
          const attemptCard = attemptCardRef.current;
          if (attemptCard) await attemptCard.flushIfSelected();
          // 저장 성공 → dirty reset (initial 동기화 효과를 위해 router.refresh)
          router.refresh();
          setSuccessMessage('저장 완료');
        } else {
          const created = await client.contacts.targets.add({
            surveyId,
            attrs,
            ...piiPatch,
            memo,
            contactMethod,
            ...systemFieldsPatch,
          });
          // 신규 저장 성공 → 방금 만든 대상의 상세 페이지로 이동.
          // new 페이지에 머물면 폼 입력이 남아 isDirty 가 계속 true → 목록 이동 시
          // confirm alert 오발생 + 재저장 시 중복 생성. push 로 떠나 둘 다 해소.
          router.push(operationsPaths(basePath).contact(created.id));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function goList() {
    if (!confirmIfDirty()) return;
    router.push(operationsPaths(basePath).contacts);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {successMessage && (
        <div
          role="status"
          className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <ContactInfoCard
            surveyId={surveyId}
            basePath={basePath}
            resid={initial?.resid ?? null}
            scheme={localScheme}
            attrs={attrs}
            piiValues={piiValues}
            failedPiiKeys={failedPiiKeys}
            memo={memo}
            contactMethod={contactMethod}
            respondedAt={initial?.respondedAt ?? null}
            responseId={initial?.responseId ?? null}
            responseReeditable={initial?.responseReeditable ?? false}
            inviteCode={initial?.inviteCode ?? null}
            readOnlyFields={!permissions.manageContacts}
            canWriteMemo={permissions.writeAttempts}
            canManageResponses={permissions.manageResponses && isEdit}
            {...(isEdit && permissions.manageContacts ? { onColumnToggle } : {})}
            onAttrsChange={setAttrs}
            onPiiChange={(k, v) => setPiiValues((prev) => ({ ...prev, [k]: v }))}
            onMemoChange={(m) => setMemo(m)}
            onContactMethodChange={setContactMethod}
          />
          <div className="mt-2 flex gap-2 rounded-lg border bg-slate-50 px-4 py-3">
            <Button variant="outline" onClick={goList}>
              목록
            </Button>
            {isEdit && permissions.manageContacts && (
              <Button
                variant="outline"
                onClick={remove}
                disabled={isPending}
                className="text-red-600 hover:text-red-700"
              >
                삭제
              </Button>
            )}
            {isEdit && initial?.inviteCode && (
              <CopyInviteUrlButton inviteCode={initial.inviteCode} />
            )}
            <span className="flex-1" />
            {/* 명단을 못 고치는 주체에게 남는 저장은 메모·연락 방법뿐이라 그렇게 적는다 —
                「저장」이라고 쓰면 화면의 값 전부가 간다고 읽힌다. 회차는 자기 버튼이 따로
                있어 이 버튼이 눌린다고 회차가 쌓이지 않는다(AC). */}
            {(permissions.manageContacts || permissions.writeAttempts) && (
              <Button onClick={save} disabled={isPending}>
                {isPending
                  ? '저장 중…'
                  : permissions.manageContacts
                    ? '저장'
                    : '메모 저장'}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {isEdit && initial ? (
            <>
              {permissions.writeAttempts && (
                <ContactAttemptAddCard
                  ref={attemptCardRef}
                  contactTargetId={initial.id}
                  surveyId={surveyId}
                  resultCodes={resultCodes}
                />
              )}
              <ContactAttemptHistoryCard
                contactTargetId={initial.id}
                surveyId={surveyId}
                attempts={initial.attempts}
                resultCodes={resultCodes}
                canDelete={permissions.writeAttempts}
              />
              {/* 메일은 연구원의 채널이다 — 발송 이력도 단건 발송도 그 축의 판정을 따른다. */}
              {permissions.viewMail && (
                <ContactMailHistoryCard
                  rows={mailHistory}
                  action={
                    mailSend && permissions.sendMail ? (
                      <SendSingleMailDialog
                        surveyId={surveyId}
                        contactTargetId={initial.id}
                        templates={mailSend.templates}
                        disabledReason={mailSend.disabledReason}
                      />
                    ) : undefined
                  }
                />
              )}
              {/* 편집 이력에는 **고친 사람의 이메일**이 실린다 — 응답 원문을 볼 수 없는
                  주체에게 내부 담당자 명단을 흘릴 이유가 없다. */}
              {permissions.manageResponses && (
                <ContactEditHistoryCard rows={editLogs} hasResponse={initial.responseId != null} />
              )}
            </>
          ) : (
            <div className="rounded-lg border bg-slate-50 p-5 text-sm text-slate-500">
              조사 대상을 먼저 저장하면 회차 기록을 추가할 수 있습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function shallowEqualRecord(a: Record<string, string>, b: Record<string, string>): boolean {
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
    if (!ac || !bc) return false;
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
