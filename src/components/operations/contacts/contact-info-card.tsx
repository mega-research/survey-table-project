'use client';

import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  CONTACT_METHOD_LABEL,
  type ContactColumnDef,
  type ContactColumnScheme,
  type ContactMethod,
} from '@/db/schema/schema-types';
import { LocalDateTime } from '@/components/ui/local-date-time';
import { attrsKeyOf, piiKeyOf } from '@/lib/operations/contacts';
import { piiFieldLabel, type PiiFieldType } from '@/lib/crypto/pii-fields';
import { buildInviteUrl } from '@/lib/survey-url';

interface ContactInfoCardProps {
  surveyId: string;
  resid: number | null;
  scheme: ContactColumnScheme;
  attrs: Record<string, string>;
  /** PII 컬럼 현재 값 (columnKey → plain). 편집 가능 — 저장 시 자동 재암호화. */
  piiValues?: Record<string, string>;
  /** 복호화 실패한 PII 컬럼 set — readonly 표시 + 편집 금지 (cipher 덮어쓰기 방지). */
  failedPiiKeys?: ReadonlySet<string>;
  memo: string | null;
  contactMethod: ContactMethod | null;
  respondedAt: Date | null;
  responseId: string | null;
  inviteCode: string | null;
  /** 헤더 토글 변경 시 호출 — 컬럼 스킴 hidden 갱신. 신규 모드는 undefined. */
  onColumnToggle?: (key: string, hidden: boolean) => void;
  /** attrs 입력 변경 */
  onAttrsChange: (attrs: Record<string, string>) => void;
  /** PII 컬럼 입력 변경 (columnKey → plain) */
  onPiiChange?: (columnKey: string, value: string) => void;
  onMemoChange: (memo: string) => void;
  onContactMethodChange: (method: ContactMethod | null) => void;
}

type InputDef =
  | { kind: 'attrs'; col: ContactColumnDef; key: string }
  | { kind: 'pii'; col: ContactColumnDef; key: string; piiType: PiiFieldType };

export function ContactInfoCard({
  surveyId,
  resid,
  scheme,
  attrs,
  piiValues,
  failedPiiKeys,
  memo,
  contactMethod,
  respondedAt,
  responseId,
  inviteCode,
  onColumnToggle,
  onAttrsChange,
  onPiiChange,
  onMemoChange,
  onContactMethodChange,
}: ContactInfoCardProps) {
  const inputDefs: InputDef[] = scheme.columns
    .flatMap<InputDef>((c) => {
      const ak = attrsKeyOf(c.source);
      if (ak) return [{ kind: 'attrs', col: c, key: ak }];
      const pk = piiKeyOf(c.source);
      if (pk && c.piiType) return [{ kind: 'pii', col: c, key: pk, piiType: c.piiType }];
      return [];
    })
    .sort((a, b) => a.col.order - b.col.order);

  function setAttrsField(attrsKey: string, value: string) {
    onAttrsChange({ ...attrs, [attrsKey]: value });
  }

  // 초대 링크(짧은 URL) — NEXT_PUBLIC_APP_URL(빌드 상수) 기준으로 조립해 SSR/클라이언트 동일.
  // 메일 초대 링크와 같은 도메인을 쓴다. env 미설정 시 상대경로로 폴백.
  const inviteBaseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  const inviteUrl = inviteCode ? buildInviteUrl(inviteCode, inviteBaseUrl) : '';

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-base font-semibold">참가기업 정보</h3>
        {resid != null && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
            resid {resid}
          </span>
        )}
      </div>

      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
        {inputDefs.length === 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            표시 가능한 컬럼이 없습니다.{' '}
            <a
              href={`/admin/surveys/${surveyId}/operations/contacts/columns`}
              className="underline"
            >
              컬럼 설정
            </a>
            에서 헤더를 추가하세요.
          </div>
        )}
        {inputDefs.map((def, idx) => {
          const value =
            def.kind === 'attrs' ? attrs[def.key] ?? '' : piiValues?.[def.key] ?? '';
          const isFailedPii = def.kind === 'pii' && failedPiiKeys?.has(def.key);
          const onChange = isFailedPii
            ? undefined
            : def.kind === 'attrs'
              ? (e: React.ChangeEvent<HTMLInputElement>) => setAttrsField(def.key, e.target.value)
              : (e: React.ChangeEvent<HTMLInputElement>) => onPiiChange?.(def.key, e.target.value);
          return (
            <div key={`${def.kind}:${def.key}`} className="flex items-center gap-3">
              <div className="flex w-40 shrink-0 items-center gap-1 text-xs text-slate-600">
                <span className="inline-block w-6 rounded bg-slate-100 px-1 text-center text-[10px] text-slate-500 tabular-nums">
                  {idx + 1}
                </span>
                <span className="truncate" title={def.col.label}>
                  {def.col.label}
                </span>
              </div>
              <div className="relative flex-1">
                <Input
                  value={isFailedPii ? '복호화 실패 — 편집 불가' : value}
                  onChange={onChange}
                  readOnly={isFailedPii}
                  className={`h-9 pr-16 ${isFailedPii ? 'cursor-not-allowed bg-rose-50 text-rose-700' : ''}`}
                  title={
                    isFailedPii
                      ? '암호 키가 바뀌었거나 데이터가 손상되어 복호화할 수 없습니다. 재업로드로 복구 가능.'
                      : undefined
                  }
                />
                {def.kind === 'pii' && (
                  <span
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                    title="암호화 저장됨"
                  >
                    {piiFieldLabel(def.piiType)}
                  </span>
                )}
              </div>
              {onColumnToggle && (
                <div className="flex shrink-0 items-center gap-1" title="조사 대상 목록 헤더로 표시">
                  <Switch
                    checked={!def.col.hidden}
                    onCheckedChange={(checked) => onColumnToggle(def.key, !checked)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* 수신방법 + Web 응답 메타 */}
        <div className="mt-3 rounded bg-slate-50 px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong className="text-xs text-slate-600">수신방법</strong>
            {(['email', 'sms', 'visit', 'mail'] as ContactMethod[]).map((m) => (
              <label key={m} className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  checked={contactMethod === m}
                  onChange={() => onContactMethodChange(m)}
                />
                {CONTACT_METHOD_LABEL[m]}
              </label>
            ))}
            {contactMethod && (
              <button
                type="button"
                className="ml-auto text-[10px] text-slate-500 hover:underline"
                onClick={() => onContactMethodChange(null)}
              >
                해제
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-xs text-slate-600">Web</strong>
            {respondedAt ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                응답 완료 <LocalDateTime value={respondedAt} />
              </span>
            ) : (
              <span className="text-xs text-slate-400">미응답</span>
            )}
            <Button size="sm" variant="outline" disabled title="후속 슬라이스 (메일발송)">
              QR
            </Button>
            {responseId ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/admin/surveys/${surveyId}/operations/profiles/${responseId}/edit`}
                  target="_blank"
                  rel="noreferrer"
                >
                  응답 보기
                </Link>
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="응답이 아직 없습니다.">
                응답 보기
              </Button>
            )}
          </div>
          {inviteCode && inviteUrl && (
            <div className="mt-1 break-all text-sm text-slate-900">
              초대 링크: {inviteUrl}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div className="mt-3">
          <Label className="text-xs text-slate-600">메모</Label>
          <textarea
            value={memo ?? ''}
            onChange={(e) => onMemoChange(e.target.value)}
            placeholder="메모할 사항을 입력해주세요."
            rows={3}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
