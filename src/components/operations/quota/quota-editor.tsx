'use client';

import { useMemo, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { CheckCircle2 } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import type { QuotaCategory, QuotaConfig, QuotaDimension } from '@/db/schema/schema-types';
import { numberFormatter } from '@/lib/operations/format';
import { cn, generateId } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

import {
  buildQuotaPivot,
  pivotCategoryIds,
  pivotColBorderClass,
  pivotColKey,
  pivotTotals,
} from './quota-pivot';

interface Props {
  surveyId: string;
  initialConfig: QuotaConfig | null;
  questions: Question[];
}

const EMPTY: QuotaConfig = { enabled: false, dimensions: [], cells: [], closedMessage: null };

/**
 * 응답자 화면 실제 폴백과 동기화 — `already-responded-view.tsx` `MESSAGES.quota_closed.body`
 * 와 동일 문구. 미리보기가 실제 응답 페이지에서 보게 될 문구와 어긋나지 않도록 상수로 공유(값 복제,
 * 컴포넌트 간 직접 import는 하지 않음 — survey-response 쪽은 이 파일을 모른다).
 */
const QUOTA_CLOSED_FALLBACK =
  '해당 조건의 모집이 완료되어 더 이상 참여하실 수 없습니다. 참여해 주셔서 감사합니다.';

/** 문항 유형 → 조건 kind. 단답 숫자는 numeric, radio/select는 choice. 그 외는 지원 안 함(null). */
function kindForQuestion(q: Question): 'choice' | 'numeric' | null {
  if (q.type === 'radio' || q.type === 'select') return 'choice';
  if (q.type === 'text' && q.inputType === 'number') return 'numeric';
  return null; // v1: checkbox/multiselect/table 미지원
}

/** 선택형 문항 보기를 카테고리 초안으로 (1보기=1카테고리). */
function choiceCategories(q: Question): QuotaCategory[] {
  return resolveChoiceOptions(q).map((opt) => ({
    id: generateId(),
    label: opt.label,
    values: [opt.value],
  }));
}

/**
 * 목표 입력 공통 — 네이티브 숫자 스피너 제거. 좁은 셀에서 위/아래 버튼이 숫자를
 * 가리는 것 방지 (webkit 계열 + Firefox appearance:textfield).
 */
const TARGET_INPUT_CLASS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

interface QuotaCombo {
  categoryIds: string[];
  labels: string[];
}

/** 조건 3개 이상일 때 매트릭스 대신 보여줄 조합 플랫 리스트(카테시안 곱). */
function cartesianCombos(dimensions: QuotaDimension[]): QuotaCombo[] {
  return dimensions.reduce<QuotaCombo[]>(
    (acc, dim) =>
      acc.flatMap((combo) =>
        dim.categories.map((cat) => ({
          categoryIds: [...combo.categoryIds, cat.id],
          labels: [...combo.labels, cat.label],
        })),
      ),
    [{ categoryIds: [], labels: [] }],
  );
}

/** dimensions[index]의 categories, 없으면 빈 배열 (noUncheckedIndexedAccess 대응). */
function categoriesOf(dimensions: QuotaDimension[], index: number): QuotaCategory[] {
  return dimensions[index]?.categories ?? [];
}

export function QuotaEditor({ surveyId, initialConfig, questions }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<QuotaConfig>(initialConfig ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // "+ 조건 추가" 셀렉트 자체의 UI 상태. 고르는 즉시 addDimensionFromQuestion 을 실행하고
  // 다시 placeholder 로 리셋 — QuotaConfig 에는 속하지 않는 순수 위젯 상태.
  const [addDimensionValue, setAddDimensionValue] = useState('');

  // 조건으로 쓸 수 있는 문항만 (단일형/단답숫자)
  const eligibleQuestions = useMemo(
    () => questions.filter((q) => kindForQuestion(q) !== null),
    [questions],
  );
  // 이미 조건으로 등록된 문항은 추가 후보에서 제외 — 동일 문항 중복 방지.
  const addableQuestions = eligibleQuestions.filter(
    (q) => !config.dimensions.some((d) => d.questionId === q.id),
  );
  const combos = useMemo(() => cartesianCombos(config.dimensions), [config.dimensions]);
  // 조건 3개 전용 피벗(행=최다 카테고리 조건, 열=나머지 둘 중첩). 그 외 개수면 null.
  const pivot = useMemo(() => buildQuotaPivot(config.dimensions), [config.dimensions]);
  const totals = useMemo(
    () => (pivot ? pivotTotals(config.cells, pivot, config.dimensions) : null),
    [config.cells, pivot, config.dimensions],
  );

  function patch(p: Partial<QuotaConfig>) {
    setConfig((prev) => ({ ...prev, ...p }));
  }

  function addDimensionFromQuestion(questionId: string) {
    const q = questions.find((x) => x.id === questionId);
    if (!q) return;
    const kind = kindForQuestion(q);
    if (!kind) return;
    const dim: QuotaDimension = {
      id: generateId(),
      questionId: q.id,
      label: q.title,
      kind,
      categories: kind === 'choice' ? choiceCategories(q) : [],
    };
    // 조건 추가 시 셀은 초기화(조합이 바뀌므로) — 목표 재입력.
    patch({ dimensions: [...config.dimensions, dim], cells: [] });
  }

  function handleAddDimension(questionId: string) {
    addDimensionFromQuestion(questionId);
    setAddDimensionValue('');
  }

  function updateCategoryRange(
    dimId: string,
    catId: string,
    range: { min?: number | null; max?: number | null; label?: string },
  ) {
    patch({
      dimensions: config.dimensions.map((d) =>
        d.id !== dimId
          ? d
          : {
              ...d,
              categories: d.categories.map((c) => (c.id === catId ? { ...c, ...range } : c)),
            },
      ),
    });
  }

  function addNumericCategory(dimId: string) {
    patch({
      dimensions: config.dimensions.map((d) =>
        d.id !== dimId
          ? d
          : {
              ...d,
              categories: [
                ...d.categories,
                { id: generateId(), label: '새 구간', min: null, max: null },
              ],
            },
      ),
      cells: [],
    });
  }

  /** 숫자형 조건의 구간 한 줄 삭제(mockup "삭제" 링크). addNumericCategory 의 역연산, 동일 patch 조합. */
  function removeCategory(dimId: string, catId: string) {
    patch({
      dimensions: config.dimensions.map((d) =>
        d.id !== dimId ? d : { ...d, categories: d.categories.filter((c) => c.id !== catId) },
      ),
      cells: [],
    });
  }

  function removeDimension(dimId: string) {
    patch({ dimensions: config.dimensions.filter((d) => d.id !== dimId), cells: [] });
  }

  /** 매트릭스 셀 목표 설정. blank(undefined)면 셀 제거(무제한). */
  function setCellTarget(categoryIds: string[], target: number | null) {
    const key = categoryIds.join('');
    const others = config.cells.filter((c) => c.categoryIds.join('') !== key);
    patch({
      cells: target == null || Number.isNaN(target) ? others : [...others, { categoryIds, target }],
    });
  }

  function cellTargetOf(categoryIds: string[]): number | undefined {
    const key = categoryIds.join('');
    return config.cells.find((c) => c.categoryIds.join('') === key)?.target;
  }

  function validate(): string | null {
    for (const d of config.dimensions) {
      if (d.categories.length === 0) return `조건 "${d.label}"에 카테고리가 없습니다.`;
      if (d.kind === 'numeric') {
        for (const c of d.categories) {
          if (
            (c.min == null && c.max == null) ||
            (c.min != null && c.max != null && c.min >= c.max)
          ) {
            return `구간 "${c.label}"의 min/max가 올바르지 않습니다.`;
          }
        }
      }
    }
    return null;
  }

  function save() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await client.quota.save({ surveyId, config });
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
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

      {/* 1) 헤더 — 집행 스위치 + 저장 */}
      <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <Switch
            id="quota-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
          <label htmlFor="quota-enabled" className="text-sm font-medium text-slate-700">
            집행{' '}
            <span className={config.enabled ? 'font-semibold text-blue-600' : 'text-slate-400'}>
              {config.enabled ? '켜짐' : '꺼짐'}
            </span>
          </label>
        </div>
        <Button onClick={save} disabled={isPending}>
          {isPending ? '저장 중…' : '저장'}
        </Button>
      </div>

      {/* 2) 조건 카드 — eligibleQuestions Select 로 추가, choice=읽기전용 보기 목록 / numeric=구간 편집 */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold tracking-wide text-slate-400 uppercase">조건</h3>

        {config.dimensions.map((dim, i) => (
          <div key={dim.id} className="rounded-lg border bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">조건 {i + 1}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">
                  {dim.kind === 'choice' ? '옵션형' : '숫자형'}
                </span>
                <span className="text-sm text-slate-700">{dim.label}</span>
                {dim.kind === 'numeric' && (
                  <span className="text-xs text-slate-400">단답·숫자 → 구간 직접 생성</span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => removeDimension(dim.id)}
              >
                조건 삭제
              </Button>
            </div>

            {dim.kind === 'choice' ? (
              <ul aria-label={`${dim.label} 변수 목록`} className="flex flex-wrap gap-2">
                {dim.categories.map((cat, ci) => (
                  <li
                    key={cat.id}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm text-slate-700"
                  >
                    <span className="text-xs font-semibold text-blue-600">
                      {ci + 1}
                    </span>
                    {cat.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div>
                <table className="border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400">
                      <th className="px-2 pb-1 font-normal">라벨</th>
                      <th className="px-2 pb-1 font-normal">최소</th>
                      <th className="px-2 pb-1" />
                      <th className="px-2 pb-1 font-normal">최대</th>
                      <th className="px-2 pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {dim.categories.map((cat) => (
                      <tr key={cat.id}>
                        <td className="px-2 py-1">
                          <Input
                            value={cat.label}
                            onChange={(e) =>
                              updateCategoryRange(dim.id, cat.id, { label: e.target.value })
                            }
                            className="h-8 w-28 text-sm"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            value={cat.min ?? ''}
                            onChange={(e) =>
                              updateCategoryRange(dim.id, cat.id, {
                                min: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="h-8 w-20 text-center text-sm"
                          />
                        </td>
                        <td className="px-1 text-center text-xs text-slate-400">~</td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            value={cat.max ?? ''}
                            placeholder="∞"
                            onChange={(e) =>
                              updateCategoryRange(dim.id, cat.id, {
                                max: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="h-8 w-20 text-center text-sm"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => removeCategory(dim.id, cat.id)}
                          >
                            삭제
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={() => addNumericCategory(dim.id)}
                  className="mt-1 text-sm font-medium text-blue-600 hover:underline"
                >
                  + 구간 추가
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
          <Select value={addDimensionValue} onValueChange={handleAddDimension}>
            <SelectTrigger className="w-full border-dashed border-blue-300 font-semibold text-blue-600 hover:bg-blue-50">
              <SelectValue placeholder="+ 조건 추가" />
            </SelectTrigger>
            <SelectContent>
              {addableQuestions.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.title}
                  {kindForQuestion(q) === 'numeric' ? ' (단답 숫자)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {addableQuestions.length === 0 && (
            <p className="mt-2 text-xs text-slate-400">
              추가할 수 있는 문항이 없습니다. 라디오·드롭다운 단일 선택 또는 숫자 단답형 문항이
              필요합니다.
            </p>
          )}
        </div>
      </div>

      {/* 3) 조건 보기 — 조건 1개=리스트, 2개=행×열 매트릭스, 3개=피벗 테이블, 4개 이상=조합 플랫 리스트 */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-3 text-xs font-bold tracking-wide text-slate-400 uppercase">
          조건 보기
        </h3>

        {config.dimensions.length === 0 && (
          <p className="text-sm text-slate-400">조건을 먼저 추가하세요.</p>
        )}

        {config.dimensions.length === 1 && (
          <div className="max-w-sm divide-y overflow-hidden rounded-lg border">
            {categoriesOf(config.dimensions, 0).map((cat) => (
              <div key={cat.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-slate-700">{cat.label}</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="무제한"
                  value={cellTargetOf([cat.id]) ?? ''}
                  onChange={(e) =>
                    setCellTarget([cat.id], e.target.value === '' ? null : Number(e.target.value))
                  }
                  className={cn(TARGET_INPUT_CLASS, 'h-8 w-24 px-2 text-center text-sm')}
                />
              </div>
            ))}
          </div>
        )}

        {config.dimensions.length === 2 && (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="bg-slate-50 p-2" />
                  {categoriesOf(config.dimensions, 1).map((col) => (
                    <th
                      key={col.id}
                      className="border-b bg-slate-50 p-2 text-center font-semibold text-slate-700"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoriesOf(config.dimensions, 0).map((row) => (
                  <tr key={row.id}>
                    <th className="border-r bg-slate-50 px-3 py-2 text-left font-semibold whitespace-nowrap text-slate-700">
                      {row.label}
                    </th>
                    {categoriesOf(config.dimensions, 1).map((col) => {
                      const ids = [row.id, col.id];
                      return (
                        <td key={col.id} className="border-r border-b p-2 text-center">
                          <Input
                            type="number"
                            min={0}
                            placeholder="무제한"
                            value={cellTargetOf(ids) ?? ''}
                            onChange={(e) =>
                              setCellTarget(
                                ids,
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            className={cn(
                              TARGET_INPUT_CLASS,
                              'mx-auto h-9 w-20 px-2 text-center text-sm',
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {config.dimensions.length === 3 && pivot && totals && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="min-w-[110px] max-w-[160px] border-r border-b border-slate-300 bg-slate-50 px-3 py-2 text-left align-middle text-xs font-semibold break-keep text-slate-500"
                  >
                    {pivot.rowDim.label}
                  </th>
                  <th
                    rowSpan={2}
                    className="border-r border-b border-slate-300 bg-slate-100 px-3 py-2 text-center align-middle font-semibold text-slate-700"
                  >
                    계
                  </th>
                  {pivot.colOuterDim.categories.map((outer, oi) => (
                    <th
                      key={outer.id}
                      colSpan={pivot.colInnerDim.categories.length}
                      className={cn(
                        'border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-semibold text-slate-700',
                        oi < pivot.colOuterDim.categories.length - 1 &&
                          'border-r border-r-slate-300',
                      )}
                    >
                      {outer.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {pivot.columns.map((col, ci) => (
                    <th
                      key={pivotColKey(col)}
                      className={cn(
                        'border-b border-slate-300 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-500',
                        pivotColBorderClass(ci, pivot),
                      )}
                    >
                      {col.inner.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 계 행 — 설정된 목표만 합산한 read-only 요약. 저장 데이터에는 포함되지 않는다. */}
                <tr>
                  <th
                    scope="row"
                    className="border-r border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-left font-semibold text-slate-700"
                  >
                    계
                  </th>
                  <td className="border-r border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-center font-bold text-slate-900">
                    {totals.grand == null ? '—' : numberFormatter.format(totals.grand)}
                  </td>
                  {pivot.columns.map((col, ci) => {
                    const sum = totals.cols.get(pivotColKey(col));
                    return (
                      <td
                        key={pivotColKey(col)}
                        className={cn(
                          'border-b border-slate-300 bg-slate-100 px-2 py-1.5 text-center font-semibold text-slate-700',
                          pivotColBorderClass(ci, pivot),
                        )}
                      >
                        {sum == null ? '—' : numberFormatter.format(sum)}
                      </td>
                    );
                  })}
                </tr>
                {pivot.rowDim.categories.map((row, ri) => {
                  const rowSum = totals.rows.get(row.id);
                  const isLastRow = ri === pivot.rowDim.categories.length - 1;
                  return (
                    <tr key={row.id}>
                      <th
                        scope="row"
                        className={cn(
                          'border-r border-r-slate-300 bg-slate-50 px-3 py-1.5 text-left font-semibold whitespace-nowrap text-slate-700',
                          !isLastRow && 'border-b border-b-slate-200',
                        )}
                      >
                        {row.label}
                      </th>
                      <td
                        className={cn(
                          'border-r border-r-slate-300 bg-slate-50 px-2 py-1.5 text-center font-semibold text-slate-700',
                          !isLastRow && 'border-b border-b-slate-200',
                        )}
                      >
                        {rowSum == null ? '—' : numberFormatter.format(rowSum)}
                      </td>
                      {pivot.columns.map((col, ci) => {
                        const ids = pivotCategoryIds(config.dimensions, pivot, row.id, col);
                        return (
                          <td
                            key={pivotColKey(col)}
                            className={cn(
                              'p-1.5 text-center',
                              !isLastRow && 'border-b border-b-slate-200',
                              pivotColBorderClass(ci, pivot),
                            )}
                          >
                            <Input
                              type="number"
                              min={0}
                              placeholder="무제한"
                              aria-label={`${row.label} · ${col.outer.label} · ${col.inner.label} 목표`}
                              value={cellTargetOf(ids) ?? ''}
                              onChange={(e) =>
                                setCellTarget(
                                  ids,
                                  e.target.value === '' ? null : Number(e.target.value),
                                )
                              }
                              className={cn(
                                TARGET_INPUT_CLASS,
                                'mx-auto h-8 w-16 px-1 text-center text-sm',
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {config.dimensions.length > 3 && (
          <div className="divide-y overflow-hidden rounded-lg border">
            {combos.map((combo) => (
              <div
                key={combo.categoryIds.join('')}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">{combo.labels.join(' × ')}</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="무제한"
                  value={cellTargetOf(combo.categoryIds) ?? ''}
                  onChange={(e) =>
                    setCellTarget(
                      combo.categoryIds,
                      e.target.value === '' ? null : Number(e.target.value),
                    )
                  }
                  className={cn(TARGET_INPUT_CLASS, 'h-8 w-24 shrink-0 px-2 text-center text-sm')}
                />
              </div>
            ))}
          </div>
        )}

        {config.dimensions.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">빈칸 = 무제한.</p>
        )}
      </div>

      {/* 4) 마감 안내 문구 — Textarea + 응답자 화면 미리보기 */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-1 text-sm font-bold text-slate-900">마감 안내 문구</h3>
        <p className="mb-3 text-xs text-slate-500">
          쿼터가 마감된 셀에 걸린 응답자에게 표시됩니다. 줄바꿈 지원.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Textarea
              value={config.closedMessage ?? ''}
              onChange={(e) =>
                patch({ closedMessage: e.target.value === '' ? null : e.target.value })
              }
              placeholder={QUOTA_CLOSED_FALLBACK}
              className="min-h-[190px]"
            />
            <p className="mt-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              비워두면 기본 문구로 표시됩니다:{' '}
              <span className="font-medium text-slate-700">{QUOTA_CLOSED_FALLBACK}</span>
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold tracking-wide text-slate-400 uppercase">
              응답자 화면 미리보기
            </p>
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="border-b bg-slate-50 px-3 py-2 text-xs text-slate-400">
                설문 응답 페이지
              </div>
              <div className="px-8 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  <CheckCircle2 className="h-6 w-6 text-blue-500" />
                </div>
                {/* 실제 응답자 화면(already-responded-view quota_closed)과 동일 — 제목 없이 문구만 크게 */}
                <p className="text-lg leading-relaxed whitespace-pre-wrap text-gray-800">
                  {config.closedMessage?.trim() ? config.closedMessage : QUOTA_CLOSED_FALLBACK}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
