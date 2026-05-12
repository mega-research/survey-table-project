'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { updateContactColumns } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';
import { piiFieldLabel } from '@/lib/crypto/pii-fields';

interface ColumnSchemeEditorProps {
  surveyId: string;
  scheme: ContactColumnScheme;
}

export function ColumnSchemeEditor({ surveyId, scheme }: ColumnSchemeEditorProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<ContactColumnDef[]>(scheme.columns);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const newCols = [...columns];
    const target = index + dir;
    if (target < 0 || target >= newCols.length) return;
    [newCols[index], newCols[target]] = [newCols[target], newCols[index]];
    newCols.forEach((c, i) => { c.order = i + 1; });
    setColumns(newCols);
  }

  function toggleHide(index: number) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, hidden: !c.hidden } : c)));
  }

  function setLabel(index: number, label: string) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, label } : c)));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateContactColumns(surveyId, { ...scheme, columns });
        router.push(`/admin/surveys/${surveyId}/operations/contacts`);
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

      <div className="rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">순서</th>
              <th className="px-3 py-2 text-left">라벨</th>
              <th className="px-3 py-2 text-left">소스</th>
              <th className="px-3 py-2 text-left">개인정보 (암호화)</th>
              <th className="px-3 py-2 text-center">표시</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => {
              const isResid = col.source === 'system.resid';
              return (
                <tr key={col.key} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                      <Button size="sm" variant="ghost" disabled={i === columns.length - 1} onClick={() => move(i, 1)}>↓</Button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input value={col.label} onChange={(e) => setLabel(i, e.target.value)} className="h-8 text-sm" />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{col.source}</td>
                  <td
                    className="px-3 py-2 text-xs text-slate-600"
                    title={col.piiType ? '개인정보 종류는 재업로드로만 변경 가능합니다.' : undefined}
                  >
                    {col.piiType ? (
                      <span>{piiFieldLabel(col.piiType)}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Switch
                      checked={!col.hidden}
                      disabled={isResid}
                      onCheckedChange={() => toggleHide(i)}
                    />
                    {isResid && <div className="text-[10px] text-slate-400">필수</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500">
        개인정보 종류는 업로드 시점에만 결정됩니다. 바꾸려면 명단을 다시 업로드해주세요.
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={isPending}>{isPending ? '저장 중…' : '저장'}</Button>
        <Button variant="outline" onClick={() => router.back()}>취소</Button>
      </div>
    </div>
  );
}
