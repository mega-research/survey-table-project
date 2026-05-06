'use client';

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
import { attrsKeyOf } from '@/lib/operations/contacts';

interface ContactInfoCardProps {
  resid: number | null;
  scheme: ContactColumnScheme;
  attrs: Record<string, string>;
  memo: string | null;
  contactMethod: ContactMethod | null;
  respondedAt: Date | null;
  inviteToken: string | null;
  /** 헤더 토글 변경 시 호출 — 컬럼 스킴 hidden 갱신. 신규 모드는 undefined. */
  onColumnToggle?: (key: string, hidden: boolean) => void;
  /** attrs 입력 변경 */
  onAttrsChange: (attrs: Record<string, string>) => void;
  onMemoChange: (memo: string) => void;
  onContactMethodChange: (method: ContactMethod | null) => void;
}

const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function ContactInfoCard({
  resid,
  scheme,
  attrs,
  memo,
  contactMethod,
  respondedAt,
  inviteToken,
  onColumnToggle,
  onAttrsChange,
  onMemoChange,
  onContactMethodChange,
}: ContactInfoCardProps) {
  const inputDefs = scheme.columns
    .map((c) => ({ col: c, attrsKey: attrsKeyOf(c.source) }))
    .filter((x): x is { col: ContactColumnDef; attrsKey: string } => x.attrsKey != null)
    .sort((a, b) => a.col.order - b.col.order);

  function setField(attrsKey: string, value: string) {
    onAttrsChange({ ...attrs, [attrsKey]: value });
  }

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
        {inputDefs.map(({ col, attrsKey }, idx) => (
          <div key={attrsKey} className="flex items-center gap-3">
            <div className="flex w-40 shrink-0 items-center gap-1 text-xs text-slate-600">
              <span className="inline-block w-6 rounded bg-slate-100 px-1 text-center text-[10px] text-slate-500 tabular-nums">
                {idx + 1}
              </span>
              <span className="truncate" title={col.label}>{col.label}</span>
            </div>
            <Input
              value={attrs[attrsKey] ?? ''}
              onChange={(e) => setField(attrsKey, e.target.value)}
              className="h-9 flex-1"
            />
            {onColumnToggle && (
              <div className="flex shrink-0 items-center gap-1" title="컨택리스트 헤더로 표시">
                <Switch
                  checked={!col.hidden}
                  onCheckedChange={(checked) => onColumnToggle(attrsKey, !checked)}
                />
              </div>
            )}
          </div>
        ))}

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
                응답 완료 {dateFmt.format(respondedAt)}
              </span>
            ) : (
              <span className="text-xs text-slate-400">미응답</span>
            )}
            <Button size="sm" variant="outline" disabled title="후속 슬라이스 (메일발송)">
              QR
            </Button>
            <Button size="sm" variant="outline" disabled title="후속 슬라이스 (응답 보기)">
              응답 보기
            </Button>
          </div>
          {inviteToken && (
            <div className="mt-1 text-[10px] text-slate-400">
              초대 토큰: {inviteToken.slice(0, 8)}…
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
