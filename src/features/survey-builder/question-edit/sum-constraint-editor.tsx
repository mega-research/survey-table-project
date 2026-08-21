'use client';

/**
 * 숫자 셀 합계 제약(SumConstraint) 편집기 — 질문 편집 모달의 "검증 규칙" 탭 하단 섹션.
 * 셀 선택은 TablePreview 의 renderCell override 로 숫자 input 셀에만 체크 오버레이를 씌운다.
 * (기존 TableValidationEditor 의 분기 규칙과 별개 — 이쪽은 차단형 검증)
 *
 * 좌변/우변은 각각 "셀 선택 합계 ↔ 수식", "숫자 ↔ 데이터 참조" 두 모드를 토글한다.
 * 모드는 leftExpr/targetExpr 존재 여부에서 파생한다 — 로컬 state 로 이중화하지 않는다
 * (formData vs store 이중 상태로 데이터가 조용히 유실되는 버그군 재발 방지).
 */

import { useState } from 'react';

import { nanoid } from 'nanoid';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { TablePreview } from '@/features/question-renderer/table-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pruneSumConstraints } from '@/lib/survey/numeric-validation';
import type {
  CalcExpr,
  HeaderCell,
  Question,
  SumConstraint,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

import { FormulaExprEditor } from '@/features/survey-builder/formula/formula-expr-editor';

const OPERATOR_OPTIONS: Array<{ value: SumConstraint['operator']; label: string }> = [
  { value: 'eq', label: '정확히' },
  { value: 'ne', label: '와 다르게' },
  { value: 'lte', label: '이하' },
  { value: 'gte', label: '이상' },
  { value: 'lt', label: '미만' },
  { value: 'gt', label: '초과' },
];

/** 좌변을 셀 선택 → 수식 모드로 전환할 때 기존 선택을 SUM 수식으로 시드한다 (questionId 생략 = 자기 질문). */
export function seedLeftExprFromCellIds(cellIds: string[]): CalcExpr {
  return {
    kind: 'group',
    op: '+',
    terms: [{ kind: 'agg', fn: 'sum', items: cellIds.map((cellId) => ({ kind: 'cell', cellId })) }],
  };
}

interface Props {
  constraints: SumConstraint[];
  tableColumns: TableColumn[];
  tableRowsData: TableRow[];
  tableHeaderGrid?: HeaderCell[][] | undefined;
  hideColumnLabels?: boolean | undefined;
  /** FormulaExprEditor 용 — 편집 중 최신 tableRowsData 를 반영한 자기 질문 */
  ownQuestion: Question;
  allQuestions: Question[];
  onUpdate: (constraints: SumConstraint[]) => void;
}

export function SumConstraintEditor({
  constraints,
  tableColumns,
  tableRowsData,
  tableHeaderGrid,
  hideColumnLabels,
  ownQuestion,
  allQuestions,
  onUpdate,
}: Props) {
  // 규칙별 접기 상태 — 접힌 규칙은 TablePreview 를 렌더하지 않는다 (규칙 수만큼 표가 쌓이는 것 방지).
  // 모달을 열면 전부 접힘, 새로 추가한 규칙만 펼침. UI 전용 상태라 저장과 무관.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // isHidden(병합 숨김) 셀은 값을 받을 수 없으므로 합산 대상에서 제외
  const numericCellIds = new Set(
    tableRowsData
      .flatMap((row) => row.cells)
      .filter((c) => c.type === 'input' && c.inputType === 'number' && !c.isHidden)
      .map((c) => c.id),
  );

  // 저장 전 dangling cellId 정리 (이중 방어의 빌더 쪽)
  const emit = (next: SumConstraint[]) => onUpdate(pruneSumConstraints(next, tableRowsData));

  const updateAt = (index: number, patch: Partial<SumConstraint>) =>
    emit(constraints.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const toggleCell = (index: number, cellId: string) => {
    const current = constraints[index];
    if (!current) return;
    const has = current.cellIds.includes(cellId);
    updateAt(index, {
      cellIds: has ? current.cellIds.filter((id) => id !== cellId) : [...current.cellIds, cellId],
    });
  };

  // exactOptionalPropertyTypes 하에서 { errorMessage: undefined } 는 Partial<SumConstraint>
  // 에 대입 불가(값이 아닌 "키 존재"가 문제) — 클리어 시 키 자체를 destructure-drop 한다.
  const setErrorMessage = (index: number, raw: string) => {
    const current = constraints[index];
    if (!current) return;
    if (raw) {
      updateAt(index, { errorMessage: raw });
      return;
    }
    const { errorMessage: _drop, ...rest } = current;
    emit(constraints.map((c, i) => (i === index ? rest : c)));
  };

  // 모드는 leftExpr/targetExpr 존재 여부에서 파생한다 — 로컬 state 이중화 금지.
  // 주의: 셀 선택 합계 모드는 대상 셀이 전부 빈 값이면 검증 자체를 건너뛰지만(evaluateSumConstraint
  // skipped), 수식 모드는 빈 셀을 0으로 계산해 비교를 그대로 실행한다 — 토글이 완전 등가 변환은
  // 아니다(계산 셀(calc cell)과 동일 의미론이라 의도된 차이).
  const setLeftMode = (index: number, mode: 'cells' | 'expr') => {
    const current = constraints[index];
    if (!current) return;
    if (mode === 'expr') {
      if (current.leftExpr) return;
      updateAt(index, { leftExpr: seedLeftExprFromCellIds(current.cellIds) });
      return;
    }
    if (!current.leftExpr) return;
    const { leftExpr: _drop, ...rest } = current;
    emit(constraints.map((c, i) => (i === index ? rest : c)));
  };

  const setRightMode = (index: number, mode: 'number' | 'ref') => {
    const current = constraints[index];
    if (!current) return;
    if (mode === 'ref') {
      if (current.targetExpr) return;
      updateAt(index, { targetExpr: { kind: 'group', op: '+', terms: [] } });
      return;
    }
    if (!current.targetExpr) return;
    const { targetExpr: _drop, ...rest } = current;
    emit(constraints.map((c, i) => (i === index ? rest : c)));
  };

  const setTolerance = (index: number, raw: string) => {
    const current = constraints[index];
    if (!current) return;
    if (raw.includes('-')) return; // 음수 오차 무의미 (셀 편집 모달과 동일 가드)
    if (raw === '') {
      const { tolerance: _drop, ...rest } = current;
      emit(constraints.map((c, i) => (i === index ? rest : c)));
      return;
    }
    if (!isPartialNumericInput(raw)) return;
    const n = parseNumericInput(raw);
    if (n !== null) updateAt(index, { tolerance: n });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">합계 검증</h4>
          <p className="mt-0.5 text-xs text-gray-500">
            선택한 숫자 셀들의 합이 조건을 만족해야 응답자가 다음으로 진행할 수 있습니다
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const id = nanoid();
            emit([...constraints, { id, cellIds: [], operator: 'eq', target: 100 }]);
            setExpandedIds((prev) => new Set(prev).add(id));
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          규칙 추가
        </Button>
      </div>

      {numericCellIds.size === 0 && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
          숫자 input 셀이 없습니다. 셀 편집에서 입력 셀의 &quot;숫자만 입력&quot;을 먼저 켜주세요.
        </p>
      )}

      {constraints.map((constraint, index) => {
        const expanded = expandedIds.has(constraint.id);
        const operatorLabel =
          OPERATOR_OPTIONS.find((o) => o.value === constraint.operator)?.label ?? '';
        return (
          <div key={constraint.id} className="space-y-3 rounded-md border border-gray-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => toggleExpanded(constraint.id)}
                aria-expanded={expanded}
                aria-label={expanded ? '규칙 접기' : '규칙 펼치기'}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                )}
                <span className="truncate text-xs text-gray-600">
                  {constraint.leftExpr ? '수식' : `셀 ${constraint.cellIds.length}개 합계`}{' '}
                  {operatorLabel} {constraint.targetExpr ? '참조 값' : constraint.target}
                  {!constraint.leftExpr && constraint.cellIds.length === 0 && (
                    <span className="ml-1.5 font-medium text-amber-600">셀 미선택</span>
                  )}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => emit(constraints.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4 text-gray-400" />
              </Button>
            </div>

            {expanded && (
              <>
                {/* 좌변 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">비교할 값</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                    <button
                      type="button"
                      aria-pressed={!constraint.leftExpr}
                      onClick={() => setLeftMode(index, 'cells')}
                      className={`px-3 py-1 text-xs font-medium ${!constraint.leftExpr ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                    >
                      셀 선택 합계
                    </button>
                    <button
                      type="button"
                      aria-pressed={!!constraint.leftExpr}
                      onClick={() => setLeftMode(index, 'expr')}
                      className={`border-l border-gray-200 px-3 py-1 text-xs font-medium ${constraint.leftExpr ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                    >
                      수식
                    </button>
                  </div>
                </div>

                {constraint.leftExpr ? (
                  <FormulaExprEditor
                    value={constraint.leftExpr}
                    onChange={(leftExpr) => updateAt(index, { leftExpr })}
                    ownQuestion={ownQuestion}
                    allQuestions={allQuestions}
                  />
                ) : (
                  <>
                    {constraint.cellIds.length === 0 && (
                      <p className="text-xs font-medium text-amber-600">
                        합산할 셀이 선택되지 않았습니다 — 아래 표에서 셀을 선택하세요
                      </p>
                    )}
                    <TablePreview
                      columns={tableColumns}
                      rows={tableRowsData}
                      tableHeaderGrid={tableHeaderGrid}
                      hideColumnLabels={hideColumnLabels}
                      renderCell={(cell: TableCell) => {
                        if (!numericCellIds.has(cell.id)) return undefined; // 읽기 전용 폴백
                        const selected = constraint.cellIds.includes(cell.id);
                        return (
                          <label
                            className={`flex h-full w-full cursor-pointer items-center justify-center gap-1.5 rounded px-1 py-2 text-xs ${
                              selected ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-500'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleCell(index, cell.id)}
                              className="h-4 w-4"
                            />
                            합산
                          </label>
                        );
                      }}
                    />
                  </>
                )}

                {/* 조건 + 우변 */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-gray-600">
                    {constraint.leftExpr ? '계산 값이' : '선택 셀 합계가'}
                  </span>
                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                    <button
                      type="button"
                      aria-pressed={!constraint.targetExpr}
                      onClick={() => setRightMode(index, 'number')}
                      className={`px-3 py-1 text-xs font-medium ${!constraint.targetExpr ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                    >
                      숫자
                    </button>
                    <button
                      type="button"
                      aria-pressed={!!constraint.targetExpr}
                      onClick={() => setRightMode(index, 'ref')}
                      className={`border-l border-gray-200 px-3 py-1 text-xs font-medium ${constraint.targetExpr ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                    >
                      데이터 참조
                    </button>
                  </div>
                  {!constraint.targetExpr && (
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={String(constraint.target)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!isPartialNumericInput(v)) return;
                        const n = parseNumericInput(v);
                        if (n !== null) updateAt(index, { target: n });
                      }}
                      className="h-8 w-24"
                      aria-label="목표값"
                    />
                  )}
                  <select
                    value={constraint.operator}
                    onChange={(e) =>
                      updateAt(index, { operator: e.target.value as SumConstraint['operator'] })
                    }
                    className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm"
                    aria-label="비교 방식"
                  >
                    {OPERATOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {constraint.targetExpr && (
                  <FormulaExprEditor
                    value={constraint.targetExpr}
                    onChange={(targetExpr) => updateAt(index, { targetExpr })}
                    ownQuestion={ownQuestion}
                    allQuestions={allQuestions}
                  />
                )}

                {/* 오차 허용 — eq/ne 전용 */}
                {(constraint.operator === 'eq' || constraint.operator === 'ne') && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-gray-600">오차 허용 ±</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={constraint.tolerance !== undefined ? String(constraint.tolerance) : ''}
                      onChange={(e) => setTolerance(index, e.target.value)}
                      placeholder="0"
                      className="h-8 w-24"
                      aria-label="오차 허용"
                    />
                  </div>
                )}

                <Input
                  value={constraint.errorMessage ?? ''}
                  onChange={(e) => setErrorMessage(index, e.target.value)}
                  placeholder="에러 메시지 (비우면 자동 생성)"
                  className="h-8 text-sm"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
