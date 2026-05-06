'use client';

import { useEffect, useState, useTransition } from 'react';

import { addContactTarget, deleteContactTarget, updateContactTarget } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { attrsKeyOf } from '@/lib/operations/contacts';

interface ContactEditModalProps {
  surveyId: string;
  scheme: ContactColumnScheme;
  /** undefined = 추가 모드. 주어지면 편집 모드. */
  initial?: {
    id: string;
    attrs: Record<string, string>;
  };
  /** systemField 동기화용 — 컬럼 스킴에서 어느 attrs 키가 group/email/biz 인지 */
  systemFieldKeys?: {
    group?: string;
    email?: string;
    biz?: string;
  };
  onClose: () => void;
}

export function ContactEditModal({
  surveyId,
  scheme,
  initial,
  systemFieldKeys,
  onClose,
}: ContactEditModalProps) {
  const isEdit = initial != null;
  const [attrs, setAttrs] = useState<Record<string, string>>(initial?.attrs ?? {});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 컬럼 스킴의 attrs.* 컬럼만 입력창으로 사용 (system.* 제외)
  const inputDefs: Array<{ key: string; label: string; isHidden: boolean }> = scheme.columns
    .filter((c) => attrsKeyOf(c.source) != null)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      key: attrsKeyOf(c.source)!,
      label: c.label,
      isHidden: !!c.hidden,
    }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setField(key: string, value: string) {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (isEdit && initial) {
          await updateContactTarget({ id: initial.id, surveyId, attrs, systemFieldKeys });
        } else {
          await addContactTarget({ surveyId, attrs, systemFieldKeys });
        }
        onClose();
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
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b px-5 py-3">
          <h3 className="text-base font-semibold">{isEdit ? '컨택 편집' : '컨택 추가'}</h3>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          {error && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {inputDefs.length === 0 ? (
            <div className="text-sm text-slate-500">컬럼 스킴이 비어있습니다. 먼저 엑셀을 업로드하세요.</div>
          ) : (
            inputDefs.map((def) => (
              <div key={def.key}>
                <Label htmlFor={`field-${def.key}`} className="text-xs text-slate-600">
                  {def.label}
                  {def.isHidden && <span className="ml-1 text-[10px] text-slate-400">(컨택리스트 미표시)</span>}
                </Label>
                <Input
                  id={`field-${def.key}`}
                  value={attrs[def.key] ?? ''}
                  onChange={(e) => setField(def.key, e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <div>
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
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button onClick={save} disabled={isPending}>
              {isPending ? '저장 중…' : isEdit ? '저장' : '추가'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
