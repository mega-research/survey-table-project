'use client';

import { useMemo } from 'react';

import type { CellEnableCondition, TableCell } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';

/** 컨트롤러가 될 수 있는 셀 타입 — 선택형(옵션 조건) + input(값 존재/숫자 비교) */
export const GATING_CONTROLLER_CELL_TYPES = new Set<TableCell['type']>([
  'radio',
  'checkbox',
  'select',
  'input',
]);

/** 선택형 컨트롤러의 옵션 목록 (게이팅 값 = option.value ?? option.id — 응답 저장값과 동일 규약) */
function controllerOptions(cell: TableCell): Array<{ key: string; label: string }> {
  const opts = cell.radioOptions ?? cell.checkboxOptions ?? cell.selectOptions ?? [];
  return opts.map((o) => ({ key: o.value ?? o.id, label: o.label }));
}

function isChoiceController(cell: TableCell): boolean {
  return cell.type === 'radio' || cell.type === 'checkbox' || cell.type === 'select';
}

/** 컨트롤러 타입에 맞는 기본 조건 생성 (선택형 → option, input → filled) */
function defaultConditionFor(controller: TableCell): CellEnableCondition {
  if (isChoiceController(controller)) {
    return { kind: 'option', controllerCellId: controller.id, values: [] };
  }
  return { kind: 'filled', controllerCellId: controller.id };
}

interface CellGatingEditorProps {
  /** 편집 중인 셀 id — 컨트롤러 후보에서 자기 자신을 제외한다 */
  cellId: string;
  /** 같은 행의 셀 전체 */
  rowCells: TableCell[];
  condition: CellEnableCondition | undefined;
  requiredWhenEnabled: boolean;
  onConditionChange: (condition: CellEnableCondition | undefined) => void;
  onRequiredWhenEnabledChange: (v: boolean) => void;
}

/**
 * 셀 게이팅 "활성 조건" 편집 섹션 (input 셀 전용 — 스펙 5절).
 * 같은 행 컨트롤러 셀을 고르고, 컨트롤러 타입에서 조건 형태를 자동 유도한다:
 * 선택형 → 옵션 다중선택("이 중 하나 선택 시 활성"), input → 값 존재 / 숫자 비교.
 */
export function CellGatingEditor({
  cellId,
  rowCells,
  condition,
  requiredWhenEnabled,
  onConditionChange,
  onRequiredWhenEnabledChange,
}: CellGatingEditorProps) {
  const controllers = useMemo(
    () =>
      rowCells.filter(
        (c) => c.id !== cellId && !c.isHidden && GATING_CONTROLLER_CELL_TYPES.has(c.type),
      ),
    [rowCells, cellId],
  );

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
          같은 행에 선택형(라디오·체크박스·셀렉트) 또는 입력 셀이 없어 설정할 수 없습니다.
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
              {controllers.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCellLabel(c)}
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
