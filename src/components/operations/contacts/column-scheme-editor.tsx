'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';
import {
  GROUP_LEVELS,
  GROUP_LEVEL_LABELS,
  resolveGroupCriteria,
  type GroupLevel,
} from '@/lib/contacts/group-levels';
import { piiFieldLabel } from '@/lib/crypto/pii-fields';
import { client } from '@/shared/lib/rpc';

interface ColumnSchemeEditorProps {
  surveyId: string;
  scheme: ContactColumnScheme;
}

/**
 * 저장 스킴 → 편집 상태 정규화.
 * legacy groupBy 토글 저장분은 resolveGroupCriteria 가 레벨 1..4 로 해석 — 그 결과를
 * groupLevel 로 실체화하고 groupBy 는 제거한다 (저장 시 groupLevel 만 남음).
 */
function normalizeColumns(scheme: ContactColumnScheme): ContactColumnDef[] {
  const levelByKey = new Map(resolveGroupCriteria(scheme).map((c) => [c.key, c.level]));
  return scheme.columns.map((c) => {
    const { groupBy: _legacy, groupLevel: _old, ...rest } = c;
    const level = c.source.startsWith('attrs.') ? levelByKey.get(c.key) : undefined;
    return { ...rest, ...(level != null ? { groupLevel: level } : {}) };
  });
}

export function ColumnSchemeEditor({ surveyId, scheme }: ColumnSchemeEditorProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<ContactColumnDef[]>(() => normalizeColumns(scheme));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const newCols = [...columns];
    const target = index + dir;
    if (target < 0 || target >= newCols.length) return;
    const a = newCols[index];
    const b = newCols[target];
    if (!a || !b) return;
    newCols[index] = b;
    newCols[target] = a;
    // scheme.columns 의 객체 레퍼런스를 in-place 변경하지 않도록 새 객체로 매핑한다.
    setColumns(newCols.map((c, i) => ({ ...c, order: i + 1 })));
  }

  function toggleHide(index: number) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, hidden: !c.hidden } : c)));
  }

  /** 레벨 배정 — 같은 레벨을 쓰던 다른 컬럼에서는 해제(레벨당 1개). null = 없음. */
  function setGroupLevel(index: number, level: GroupLevel | null) {
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i === index) {
          const { groupLevel: _drop, ...rest } = c;
          return level != null ? { ...rest, groupLevel: level } : rest;
        }
        if (level != null && c.groupLevel === level) {
          const { groupLevel: _drop, ...rest } = c;
          return rest;
        }
        return c;
      }),
    );
  }

  function setLabel(index: number, label: string) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, label } : c)));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await client.contacts.columns.update({ surveyId, scheme: { ...scheme, columns } });
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
              <th className="px-3 py-2 text-center">분류 기준</th>
              <th className="px-3 py-2 text-center">표시</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => {
              const canGroupBy = col.source.startsWith('attrs.');
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
                  <td
                    className="px-3 py-2 text-center"
                    title={
                      !canGroupBy
                        ? '명단 속성(attrs) 컬럼만 분류 기준으로 지정할 수 있습니다.'
                        : undefined
                    }
                  >
                    {canGroupBy ? (
                      <Select
                        value={col.groupLevel != null ? String(col.groupLevel) : '_none'}
                        onValueChange={(v) =>
                          setGroupLevel(i, v === '_none' ? null : (Number(v) as GroupLevel))
                        }
                      >
                        <SelectTrigger className="h-8 w-[110px] text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">없음</SelectItem>
                          {GROUP_LEVELS.map((l) => (
                            <SelectItem key={l} value={String(l)}>
                              {GROUP_LEVEL_LABELS[l]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Switch checked={!col.hidden} onCheckedChange={() => toggleHide(i)} />
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
      <div className="text-xs text-slate-500">
        분류 기준: 컬럼을 대·중·소·세부분류 레벨에 배정하면 진척보고가 그 순서대로 조합
        집계합니다. 레벨당 컬럼 1개이며, 이미 쓰인 레벨을 고르면 기존 컬럼에서 해제됩니다.
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={isPending}>{isPending ? '저장 중…' : '저장'}</Button>
        <Button variant="outline" onClick={() => router.back()}>취소</Button>
      </div>
    </div>
  );
}
