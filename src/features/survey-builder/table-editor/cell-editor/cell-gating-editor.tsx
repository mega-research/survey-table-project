'use client';

import { useMemo } from 'react';

import type { CellEnableCondition, TableCell, TableRow } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';

/**
 * 컨트롤러가 될 수 있는 셀 타입 — 선택형(옵션 조건) + input(값 존재/숫자 비교)
 * + 보기 옵션(choice_opt — 그 보기가 선택되면 활성, 보기 소스 표 전용).
 */
export const GATING_CONTROLLER_CELL_TYPES = new Set<TableCell['type']>([
  'radio',
  'checkbox',
  'select',
  'input',
  'choice_opt',
]);

/** 선택형 컨트롤러의 옵션 목록 (게이팅 값 = option.value ?? option.id — 응답 저장값과 동일 규약) */
function controllerOptions(cell: TableCell): Array<{ key: string; label: string }> {
  const opts = cell.radioOptions ?? cell.checkboxOptions ?? cell.selectOptions ?? [];
  return opts.map((o) => ({ key: o.value ?? o.id, label: o.label }));
}

function isChoiceController(cell: TableCell): boolean {
  return cell.type === 'radio' || cell.type === 'checkbox' || cell.type === 'select';
}

/** 보기 옵션 셀의 표시 라벨 — 셀 텍스트 > 보기 라벨 > 셀 코드. */
function choiceOptLabel(cell: TableCell): string {
  const text = (cell.content ?? '').trim() || (cell.choiceLabel ?? '').trim();
  return text ? `보기 옵션: ${text}` : formatCellLabel(cell);
}

/** 컨트롤러 타입에 맞는 기본 조건 생성 (선택형 → option, 보기 옵션 → choice-selected, input → filled) */
function defaultConditionFor(controller: TableCell): CellEnableCondition {
  if (controller.type === 'choice_opt') {
    return { kind: 'choice-selected', controllerCellId: controller.id };
  }
  if (isChoiceController(controller)) {
    return { kind: 'option', controllerCellId: controller.id, values: [] };
  }
  return { kind: 'filled', controllerCellId: controller.id };
}

interface CellGatingEditorProps {
  /** 편집 중인 셀 id — 컨트롤러 후보에서 자기 자신을 제외한다 */
  cellId: string;
  /** 이 표의 행 전체. 컨트롤러는 같은 표 안이면 어느 행이든 된다 — 같은 행을 먼저 보여준다. */
  rows: readonly TableRow[];
  condition: CellEnableCondition | undefined;
  requiredWhenEnabled: boolean;
  onConditionChange: (condition: CellEnableCondition | undefined) => void;
  onRequiredWhenEnabledChange: (v: boolean) => void;
}

/** 컨트롤러 후보 — 표 안의 선택형·입력 셀. 같은 행이 앞, 다른 행은 행 라벨을 붙여 뒤에. */
interface ControllerCandidate {
  cell: TableCell;
  label: string;
}

function collectControllerCandidates(
  rows: readonly TableRow[],
  cellId: string,
): ControllerCandidate[] {
  const ownRow = rows.find((r) => r.cells.some((c) => c.id === cellId));
  const isCandidate = (c: TableCell) =>
    c.id !== cellId && !c.isHidden && GATING_CONTROLLER_CELL_TYPES.has(c.type);
  const labelOf = (cell: TableCell) =>
    cell.type === 'choice_opt' ? choiceOptLabel(cell) : formatCellLabel(cell);
  const own = (ownRow?.cells ?? []).filter(isCandidate).map((cell) => ({
    cell,
    label: labelOf(cell),
  }));
  const others = rows.flatMap((r, index) => {
      if (r === ownRow) return [];
      const rowLabel = r.label?.trim() || `${index + 1}행`;
      return r.cells.filter(isCandidate).map((cell) => ({
        cell,
        label: `${rowLabel} · ${labelOf(cell)}`,
      }));
    });
  return [...own, ...others];
}

/**
 * 셀 게이팅 "활성 조건" 편집 섹션 (input 셀 전용 — 스펙 5절).
 * 표 안 컨트롤러 셀(어느 행이든)을 고르고, 컨트롤러 타입에서 조건 형태를 자동 유도한다:
 * 선택형 → 옵션 다중선택("이 중 하나 선택 시 활성"), input → 값 존재 / 숫자 비교.
 */
export function CellGatingEditor({
  cellId,
  rows,
  condition,
  requiredWhenEnabled,
  onConditionChange,
  onRequiredWhenEnabledChange,
}: CellGatingEditorProps) {
  const candidates = useMemo(() => collectControllerCandidates(rows, cellId), [rows, cellId]);
  const controllers = useMemo(() => candidates.map((c) => c.cell), [candidates]);

  const controller = condition
    ? controllers.find((c) => c.id === condition.controllerCellId)
    : undefined;

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      onConditionChange(undefined);
      onRequiredWhenEnabledChange(false);
      return;
    }
    const first = controllers[0];
    if (first) onConditionChange(defaultConditionFor(first));
  };

  const handleControllerChange = (id: string) => {
    const next = controllers.find((c) => c.id === id);
    if (next) onConditionChange(defaultConditionFor(next));
  };

  const toggleOptionValue = (key: string) => {
    if (condition?.kind !== 'option') return;
    const values = condition.values.includes(key)
      ? condition.values.filter((v) => v !== key)
      : [...condition.values, key];
    onConditionChange({ ...condition, values });
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <div className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          id="cell-gating-toggle"
          checked={condition !== undefined}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={condition === undefined && controllers.length === 0}
          className="h-4 w-4"
        />
        <label htmlFor="cell-gating-toggle" className="cursor-pointer font-medium text-gray-900">
          다른 셀 값에 따라 활성화
        </label>
        <span className="text-xs text-gray-400">
          조건 충족 시에만 셀이 표시되고, 미충족 시 숨겨지며 값이 지워집니다
        </span>
      </div>

      {condition === undefined && controllers.length === 0 && (
        <p className="mt-2 text-xs text-gray-400">
          이 표에 선택형(라디오·체크박스·셀렉트) 또는 입력 셀이 없어 설정할 수 없습니다.
        </p>
      )}

      {condition !== undefined && (
        <div className="mt-3 space-y-3 pl-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-gray-600">컨트롤러</span>
            <select
              value={condition.controllerCellId}
              onChange={(e) => handleControllerChange(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {!controller && (
                <option value={condition.controllerCellId}>
                  (삭제된 셀: {condition.controllerCellId.slice(0, 6)})
                </option>
              )}
              {candidates.map((c) => (
                <option key={c.cell.id} value={c.cell.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {controller && isChoiceController(controller) && condition.kind === 'option' && (
            <div className="space-y-1">
              <p className="text-xs text-gray-600">이 중 하나 선택 시 활성:</p>
              {controllerOptions(controller).map((opt) => (
                <label key={opt.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={condition.values.includes(opt.key)}
                    onChange={() => toggleOptionValue(opt.key)}
                    className="h-4 w-4"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
              {condition.values.length === 0 && (
                <p className="text-xs text-amber-600">
                  옵션을 하나 이상 선택하세요 — 선택이 없으면 이 셀은 항상 비활성입니다.
                </p>
              )}
            </div>
          )}

          {controller && controller.type === 'choice_opt' && condition.kind === 'choice-selected' && (
            <p className="text-xs text-gray-600">
              이 보기가 선택되면 활성됩니다. 해제되면 입력칸이 사라지고 값이 지워집니다.
            </p>
          )}

          {controller && controller.type === 'input' && (
            <div className="space-y-2 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="cell-gating-input-kind"
                  checked={condition.kind === 'filled'}
                  onChange={() =>
                    onConditionChange({ kind: 'filled', controllerCellId: controller.id })
                  }
                  className="h-4 w-4"
                />
                <span>값이 있으면 활성</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="cell-gating-input-kind"
                  checked={condition.kind === 'numeric'}
                  onChange={() =>
                    onConditionChange({
                      kind: 'numeric',
                      controllerCellId: controller.id,
                      op: '>=',
                      value: 1,
                    })
                  }
                  className="h-4 w-4"
                />
                <span>숫자 비교</span>
              </label>
              {condition.kind === 'numeric' && (
                <div className="flex items-center gap-2 pl-6">
                  <select
                    value={condition.op}
                    onChange={(e) =>
                      onConditionChange({
                        ...condition,
                        op: e.target.value as typeof condition.op,
                      })
                    }
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {(['>', '>=', '<', '<=', '==', '!='] as const).map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={condition.value}
                    onChange={(e) =>
                      onConditionChange({ ...condition, value: Number(e.target.value) || 0 })
                    }
                    className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id="cell-gating-required"
              checked={requiredWhenEnabled}
              onChange={(e) => onRequiredWhenEnabledChange(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="cell-gating-required" className="cursor-pointer">
              활성화되면 필수
            </label>
            <span className="text-xs text-gray-400">
              활성 상태에서 비어 있으면 다음으로 진행할 수 없습니다
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
