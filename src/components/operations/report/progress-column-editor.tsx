'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { client } from '@/shared/lib/rpc';
import type {
  ContactColumnScheme,
  ProgressColumnDef,
  ProgressColumnScheme,
} from '@/db/schema/schema-types';

interface Props {
  surveyId: string;
  initialScheme: ProgressColumnScheme;
  /** contact_columns 의 attrs.<key> 풀 — 모든 attrs 키를 자동 노출하는 소스 */
  contactScheme: ContactColumnScheme | null;
}

const ATTRS_PREFIX = 'attrs.';

/**
 * 조사 대상 목록 attrs 풀 + initialScheme 머지.
 *
 * - 조사 대상 목록의 모든 `attrs.<key>` 를 풀로 추출 (사용자 편집 order 정렬).
 * - initialScheme 에 같은 key 가 존재하면 기존 값(label/order/hidden) 사용.
 * - 매칭 없으면 디폴트 hidden=true, 라벨은 조사 대상 목록 라벨.
 * - contactScheme 에서 사라진 키(고아)는 결과에 포함되지 않음 → save 후 자동 정리.
 */
function hydrateColumns(
  contactScheme: ContactColumnScheme | null,
  initialScheme: ProgressColumnScheme,
): ProgressColumnDef[] {
  const attrsPool = (contactScheme?.columns ?? [])
    .filter((c) => c.source.startsWith(ATTRS_PREFIX))
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      key: c.source.slice(ATTRS_PREFIX.length),
      contactLabel: c.label,
    }));
  const existingMap = new Map(initialScheme.columns.map((c) => [c.key, c]));

  const merged = attrsPool.map((p, i): ProgressColumnDef => {
    const existing = existingMap.get(p.key);
    if (existing) return existing;
    return {
      key: p.key,
      label: p.contactLabel,
      order: i, // 조사 대상 목록 풀 순서를 디폴트로
      hidden: true,
    };
  });

  return merged.sort((a, b) => a.order - b.order);
}

export function ProgressColumnEditor({ surveyId, initialScheme, contactScheme }: Props) {
  const router = useRouter();

  const hydratedColumns = useMemo<ProgressColumnDef[]>(
    () => hydrateColumns(contactScheme, initialScheme),
    [contactScheme, initialScheme],
  );

  const [columns, setColumns] = useState<ProgressColumnDef[]>(hydratedColumns);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setColumns(next.map((c, idx) => ({ ...c, order: idx })));
  };

  const updateLabel = (i: number, label: string) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, label } : c)));
  };

  const toggleHidden = (i: number) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, hidden: !c.hidden } : c)));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await client.operations.progress.updateColumns({
        surveyId,
        scheme: { version: 1, columns },
      });
      if (!result.ok) {
        setError(result.error ?? '저장에 실패했습니다.');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
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
              <th className="px-3 py-2 text-center">표시</th>
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  조사 대상 목록에 attrs 컬럼이 없습니다. 먼저 엑셀을 업로드하거나 조사 대상 목록 컬럼 설정을 확인하세요.
                </td>
              </tr>
            )}
            {columns.map((c, i) => (
              <tr key={c.key} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="위로"
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === columns.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="아래로"
                    >
                      ↓
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={c.label}
                    onChange={(e) => updateLabel(i, e.target.value)}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">attrs.{c.key}</td>
                <td className="px-3 py-2 text-center">
                  <Checkbox
                    checked={!c.hidden}
                    onCheckedChange={() => toggleHidden(i)}
                    aria-label={`${c.label} 표시`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          취소
        </Button>
      </div>
    </div>
  );
}
