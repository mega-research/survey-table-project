'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GROUP_LEVELS,
  GROUP_LEVEL_LABELS,
  resolveGroupCriteria,
  type GroupLevel,
} from '@/lib/contacts/group-levels';
import { client } from '@/shared/lib/rpc';
import type {
  ProgressColumnDef,
  ProgressColumnScheme,
} from '@/db/schema/schema-types';
import type { NormalizedContactColumnScheme } from '@/lib/operations/contacts';

interface Props {
  surveyId: string;
  initialScheme: ProgressColumnScheme;
  /** contact_columns 의 attrs.<key> 풀 — 모든 attrs 키를 자동 노출하는 소스 */
  contactScheme: NormalizedContactColumnScheme | null;
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
  contactScheme: NormalizedContactColumnScheme | null,
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
  // 시스템ID(firstResid) 컬럼 표시 여부 — 진척률 표 전용, 조사 대상 목록 표시와 독립.
  const [showResid, setShowResid] = useState<boolean>(initialScheme.showResid ?? true);
  const residLabel =
    contactScheme?.columns.find((c) => c.source === 'system.resid')?.label?.trim() || '시스템ID';
  // 분류 기준 레벨 (attrs key → 레벨) — 조사대상목록 컬럼 설정과 같은
  // contactColumns.groupLevel 을 편집한다 (저장 시 contacts.columns.update 동시 호출).
  const [levels, setLevels] = useState<Record<string, GroupLevel>>(() =>
    Object.fromEntries(resolveGroupCriteria(contactScheme).map((c) => [c.key, c.level])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** 레벨 배정 — 레벨당 컬럼 1개 (이미 쓰인 레벨을 고르면 기존 키에서 해제). */
  const setLevel = (key: string, level: GroupLevel | null) => {
    setLevels((prev) => {
      const next: Record<string, GroupLevel> = {};
      for (const [k, l] of Object.entries(prev)) {
        if (k === key) continue;
        if (level != null && l === level) continue;
        next[k] = l;
      }
      if (level != null) next[key] = level;
      return next;
    });
  };

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
      try {
        const result = await client.operations.progress.updateColumns({
          surveyId,
          scheme: { version: 1, columns, showResid },
        });
        if (!result.ok) {
          setError(result.error ?? '저장에 실패했습니다.');
          return;
        }
        // 분류 기준 레벨은 contactColumns 소유 — 레벨만 패치하는 전용 mutation 으로
        // 저장 (스킴 전체 덮어쓰기 금지: 동시 편집 유실 방지, 서버가 최신 스킴에 반영)
        if (contactScheme) {
          await client.contacts.columns.updateGroupLevels({ surveyId, levels });
        }
        router.refresh();
      } catch (e) {
        // 인증 만료/네트워크 장애/서버 500 등 RPC throw 경로를 배너로 노출
        setError((e as Error).message);
      }
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
              <th className="px-3 py-2 text-center">분류 기준</th>
              <th className="px-3 py-2 text-center">표시</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-slate-50/50">
              <td className="px-3 py-2 text-xs text-slate-400">고정</td>
              <td className="px-3 py-2 text-sm text-slate-700">{residLabel}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">system.resid</td>
              <td className="px-3 py-2 text-center text-slate-300">—</td>
              <td className="px-3 py-2 text-center">
                <Checkbox
                  aria-label={`${residLabel} 표시`}
                  checked={showResid}
                  onCheckedChange={(checked) => setShowResid(checked === true)}
                />
              </td>
            </tr>
            {columns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
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
                  <Select
                    value={levels[c.key] != null ? String(levels[c.key]) : '_none'}
                    onValueChange={(v) =>
                      setLevel(c.key, v === '_none' ? null : (Number(v) as GroupLevel))
                    }
                  >
                    <SelectTrigger className="mx-auto h-8 w-[110px] text-sm">
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
                </td>
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

      <div className="text-xs text-slate-500">
        분류 기준: 대·중·소·세부분류 레벨에 배정하면 진척률 표가 그 순서대로 조합 집계합니다.
        조사 대상 목록 컬럼 설정과 같은 설정을 편집하며, 어느 쪽에서 바꿔도 동기화됩니다.
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
