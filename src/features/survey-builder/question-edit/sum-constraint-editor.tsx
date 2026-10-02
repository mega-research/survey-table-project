'use client';

/**
 * 숫자 셀 합계 제약(SumConstraint) 편집기 — 질문 편집 모달의 "검증 규칙" 탭 하단 섹션.
 * 셀 선택은 TablePreview 의 renderCell override 로 숫자 input 셀에만 체크 오버레이를 씌운다.
 * (기존 TableValidationEditor 의 분기 규칙과 별개 — 이쪽은 차단형 검증)
 *
 * 좌변은 "셀 선택 합계 · 입력된 칸 수 · 수식" 세 모드, 우변은 "숫자 ↔ 데이터 참조" 두 모드다.
 * 「입력된 칸 수」 는 "이 칸들 중 N칸 이상 입력" 용이라 숫자 칸뿐 아니라 인터랙티브 셀 전부를
 * 고를 수 있고, 기준값은 숫자만 받는다(참조·오차 없음).
 * 모드는 leftExpr/aggregate/targetExpr 에서 파생한다 — 로컬 state 로 이중화하지 않는다
 * (formData vs store 이중 상태로 데이터가 조용히 유실되는 버그군 재발 방지).
 */

import { useState } from 'react';

import { nanoid } from 'nanoid';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { TablePreview } from '@/features/question-renderer/table-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pruneSumConstraints } from '@/features/survey-builder/utils/prune-sum-constraints';
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
import { REQUIRED_CELL_TYPES } from '@/utils/table-cell-semantics';

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

type LeftMode = 'cells' | 'count' | 'expr';

/** 좌변 모드 — 수식이 있으면 수식, 없으면 집계 방식에서 파생한다. */
export function leftModeOf(constraint: SumConstraint): LeftMode {
  if (constraint.leftExpr) return 'expr';
  return constraint.aggregate === 'count' ? 'count' : 'cells';
}

/**
 * 좌변 모드 전환 — 모드에 맞지 않는 필드를 함께 정리한 새 규칙을 돌려준다.
 * - 수식: 기존 선택을 SUM 수식으로 시드한다(칸 수에서 오면 숫자 칸만 남긴 뒤).
 * - 입력된 칸 수: 수식·데이터 참조·오차를 걷어낸다. 기준값이 합계용 기본값(100) 그대로면 1 로 낮춘다.
 * - 셀 선택 합계: 숫자 칸이 아닌 선택을 뺀다(합산할 수 없다).
 */
export function switchLeftMode(
  constraint: SumConstraint,
  mode: LeftMode,
  numericCellIds: ReadonlySet<string>,
): SumConstraint {
  if (leftModeOf(constraint) === mode) return constraint;
  const { leftExpr: _leftExpr, aggregate: _aggregate, ...base } = constraint;
  const numericOnly = base.cellIds.filter((id) => numericCellIds.has(id));
  if (mode === 'expr') {
    return { ...base, cellIds: numericOnly, leftExpr: seedLeftExprFromCellIds(numericOnly) };
  }
  if (mode === 'cells') return { ...base, cellIds: numericOnly };
  const { targetExpr: _targetExpr, tolerance: _tolerance, ...rest } = base;
  return {
    ...rest,
    aggregate: 'count',
    target: leftModeOf(constraint) === 'cells' && rest.target === 100 ? 1 : rest.target,
    operator: leftModeOf(constraint) === 'cells' && rest.operator === 'eq' ? 'gte' : rest.operator,
  };
}

const LEFT_MODE_OPTIONS: Array<{ value: LeftMode; label: string }> = [
  { value: 'cells', label: '셀 선택 합계' },
  { value: 'count', label: '입력된 칸 수' },
  { value: 'expr', label: '수식' },
];

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

  // 「입력된 칸 수」 대상 — 응답을 받는 인터랙티브 셀 전부 (필수 셀 대상과 같은 집합)
  const interactiveCellIds = new Set(
    tableRowsData
      .flatMap((row) => row.cells)
      .filter((c) => REQUIRED_CELL_TYPES.has(c.type) && !c.isHidden)
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
  const setLeftMode = (index: number, mode: LeftMode) => {
    const current = constraints[index];
    if (!current) return;
    const next = switchLeftMode(current, mode, numericCellIds);
    if (next !== current) emit(constraints.map((c, i) => (i === index ? next : c)));
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
            선택한 숫자 셀들의 합, 또는 선택한 칸 중 입력된 칸 수가 조건을 만족해야 응답자가 다음으로
            진행할 수 있습니다
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

      {numericCellIds.size === 0 && interactiveCellIds.size === 0 && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
          숫자 input 셀이 없습니다. 셀 편집에서 입력 셀의 &quot;숫자만 입력&quot;을 먼저 켜주세요.
        </p>
      )}

      {constraints.map((constraint, index) => {
        const expanded = expandedIds.has(constraint.id);
        const leftMode = leftModeOf(constraint);
        const isCount = leftMode === 'count';
        const selectableCellIds = isCount ? interactiveCellIds : numericCellIds;
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
                  {leftMode === 'expr'
                    ? '수식'
                    : isCount
                      ? `칸 ${constraint.cellIds.length}개 중 입력된 칸 수`
                      : `셀 ${constraint.cellIds.length}개 합계`}{' '}
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
                    {LEFT_MODE_OPTIONS.map((option, optionIndex) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={leftMode === option.value}
                        onClick={() => setLeftMode(index, option.value)}
                        className={`px-3 py-1 text-xs font-medium ${optionIndex > 0 ? 'border-l border-gray-200' : ''} ${leftMode === option.value ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {isCount && (
                  <p className="text-xs text-gray-500">
                    고른 칸 중 응답이 들어 있는 칸의 수를 셉니다(숫자 0 도 입력). 전부 비어 있어도, 표를
                    건드리지 않았어도 검사합니다 — &quot;이 칸들 중 하나 이상 입력&quot; 에 씁니다. 숨은
                    행·비활성 칸은 세지 않습니다.
                  </p>
                )}

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
                        {isCount
                          ? '대상 칸이 선택되지 않았습니다 — 아래 표에서 칸을 선택하세요'
                          : '합산할 셀이 선택되지 않았습니다 — 아래 표에서 셀을 선택하세요'}
                      </p>
                    )}
                    <TablePreview
                      columns={tableColumns}
                      rows={tableRowsData}
                      tableHeaderGrid={tableHeaderGrid}
                      hideColumnLabels={hideColumnLabels}
                      renderCell={(cell: TableCell) => {
                        if (!selectableCellIds.has(cell.id)) return undefined; // 읽기 전용 폴백
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
                            {isCount ? '대상' : '합산'}
                          </label>
                        );
                      }}
                    />
                  </>
                )}

                {/* 조건 + 우변 */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-gray-600">
                    {leftMode === 'expr' ? '계산 값이' : isCount ? '입력된 칸 수가' : '선택 셀 합계가'}
                  </span>
                  <div
                    className={`inline-flex overflow-hidden rounded-md border border-gray-200 ${isCount ? 'hidden' : ''}`}
                  >
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
                {!isCount && (constraint.operator === 'eq' || constraint.operator === 'ne') && (
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
                  placeholder="에러 메시지 (비우면 자동 생성) — {현재값}·{기준값} 을 쓰면 숫자로 바뀜"
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
