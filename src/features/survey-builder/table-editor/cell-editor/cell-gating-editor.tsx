'use client';

import { useId, useMemo } from 'react';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TermControls } from '@/features/survey-builder/formula/formula-expr-editor';
import type {
  CellEnableCondition,
  CellEnableGroupCondition,
  CellEnableLeafCondition,
  ConditionLogicType,
  TableCell,
  TableRow,
} from '@/types/survey';
import { isGateGroup } from '@/utils/cell-gate-tree';
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
function defaultConditionFor(controller: TableCell): CellEnableLeafCondition {
  if (controller.type === 'choice_opt') {
    return { kind: 'choice-selected', controllerCellId: controller.id };
  }
  if (isChoiceController(controller)) {
    return { kind: 'option', controllerCellId: controller.id, values: [] };
  }
  return { kind: 'filled', controllerCellId: controller.id };
}

/**
 * 묶음 연산자 — 어휘와 문구는 문항 표시조건(question-condition-editor)과 같다.
 * NOT 은 "하나도 충족하지 않음"(NOR)이다.
 */
const GROUP_OP_OPTIONS: Array<{ value: ConditionLogicType; label: string }> = [
  { value: 'AND', label: 'AND - 모든 조건을 만족해야 함' },
  { value: 'OR', label: 'OR - 하나라도 만족하면 됨' },
  { value: 'NOT', label: 'NOT - 모든 조건을 만족하지 않아야 함' },
];

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
 * 셀 게이팅 "활성 조건" 편집 섹션 (게이팅 가능 셀 전용 — 스펙 5절).
 *
 * 조건이 하나면 컨트롤러 셀(어느 행이든)을 고르고 컨트롤러 타입에서 조건 형태를 자동 유도한다:
 * 선택형 → 옵션 다중선택("이 중 하나 선택 시 활성"), input → 값 존재 / 숫자 비교.
 * "조건 추가" 를 누르면 묶음(연산자 1개 + 조건 N개)이 되고, 연산자를 섞으려면 하위 묶음을
 * 넣는다 — 계산 셀 수식 편집기(FormulaExprEditor)와 같은 모델이다.
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
  const firstController = candidates[0]?.cell;

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      onConditionChange(undefined);
      onRequiredWhenEnabledChange(false);
      return;
    }
    if (firstController) onConditionChange(defaultConditionFor(firstController));
  };

  const makeLeaf = (): CellEnableLeafCondition | undefined =>
    firstController ? defaultConditionFor(firstController) : undefined;

  /** 단일 조건 → 묶음 승격. 기본 연산자는 표시조건과 같이 AND. */
  const wrapInGroup = () => {
    if (!condition || isGateGroup(condition)) return;
    const added = makeLeaf();
    if (!added) return;
    onConditionChange({ kind: 'group', op: 'AND', terms: [condition, added] });
  };

  /**
   * 최상위 묶음에 조건이 하나만 남으면 단일 조건으로 되돌린다 — 화면이 원래의 단순한 모양으로
   * 돌아온다. NOT 은 조건 하나여도 뜻이 달라(부정) 그대로 둔다.
   */
  const handleRootGroupChange = (next: CellEnableGroupCondition) => {
    const only = next.terms.length === 1 ? next.terms[0] : undefined;
    if (only && !isGateGroup(only) && next.op !== 'NOT') {
      onConditionChange(only);
      return;
    }
    onConditionChange(next);
  };

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <div className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          id="cell-gating-toggle"
          checked={condition !== undefined}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={condition === undefined && candidates.length === 0}
          className="h-4 w-4"
        />
        <label htmlFor="cell-gating-toggle" className="cursor-pointer font-medium text-gray-900">
          다른 셀 값에 따라 활성화
        </label>
        <span className="text-xs text-gray-400">
          조건 충족 시에만 셀이 표시되고, 미충족 시 숨겨지며 값이 지워집니다
        </span>
      </div>

      {condition === undefined && candidates.length === 0 && (
        <p className="mt-2 text-xs text-gray-400">
          이 표에 선택형(라디오·체크박스·셀렉트) 또는 입력 셀이 없어 설정할 수 없습니다.
        </p>
      )}

      {condition !== undefined && (
        <div className="mt-3 space-y-3 pl-6">
          {isGateGroup(condition) ? (
            <GateGroupBlock
              value={condition}
              onChange={handleRootGroupChange}
              depth={0}
              candidates={candidates}
              makeLeaf={makeLeaf}
            />
          ) : (
            <>
              <GateLeafEditor
                condition={condition}
                onChange={onConditionChange}
                candidates={candidates}
                standalone
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={wrapInGroup}
                disabled={!firstController}
                title="조건을 여러 개 두고 AND · OR · NOT 으로 묶습니다"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                조건 추가
              </Button>
            </>
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

interface GateGroupBlockProps {
  value: CellEnableGroupCondition;
  onChange: (next: CellEnableGroupCondition) => void;
  depth: number;
  candidates: ControllerCandidate[];
  makeLeaf: () => CellEnableLeafCondition | undefined;
}

/**
 * 조건 묶음 블록 — 연산자 1개 + 조건 N개. 하위 묶음의 삭제·이동은 그 묶음을 조건으로 가진
 * 부모의 TermControls 가 담당한다 (FormulaExprEditor 의 GroupBlock 과 같은 구조).
 */
function GateGroupBlock({ value, onChange, depth, candidates, makeLeaf }: GateGroupBlockProps) {
  const setTermAt = (index: number, next: CellEnableCondition) =>
    onChange({ ...value, terms: value.terms.map((t, i) => (i === index ? next : t)) });

  const removeTermAt = (index: number) =>
    onChange({ ...value, terms: value.terms.filter((_, i) => i !== index) });

  const moveTerm = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.terms.length) return;
    const terms = [...value.terms];
    const [moved] = terms.splice(index, 1);
    if (!moved) return;
    terms.splice(target, 0, moved);
    onChange({ ...value, terms });
  };

  const addLeaf = () => {
    const leaf = makeLeaf();
    if (leaf) onChange({ ...value, terms: [...value.terms, leaf] });
  };

  const addGroup = () => {
    const leaf = makeLeaf();
    if (!leaf) return;
    // 하위 묶음은 바깥과 다른 연산자를 쓰려고 넣는 것이라 기본값을 바깥과 다르게 준다.
    const op: ConditionLogicType = value.op === 'OR' ? 'AND' : 'OR';
    onChange({ ...value, terms: [...value.terms, { kind: 'group', op, terms: [leaf] }] });
  };

  return (
    <div
      className={
        depth === 0
          ? 'space-y-2 rounded border bg-gray-50/50 p-3'
          : 'space-y-2 border-l-2 border-blue-200 bg-white/60 py-1 pl-3'
      }
    >
      <div className="flex items-center gap-2">
        <select
          value={value.op}
          onChange={(e) => onChange({ ...value, op: e.target.value as ConditionLogicType })}
          aria-label="조건 결합 방식"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {GROUP_OP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {value.op === 'NOT' && (
        <p className="text-xs text-gray-500">
          컨트롤러가 미응답이면 그 조건은 미충족으로 봅니다 — 아무것도 답하지 않은 처음 상태에서 이
          묶음은 충족입니다.
        </p>
      )}

      {value.terms.length === 0 && (
        <p className="text-xs font-medium text-amber-600">
          조건이 없는 묶음은 항상 충족으로 봅니다 — 조건을 추가하거나 묶음을 삭제하세요
        </p>
      )}

      <div className="space-y-2">
        {value.terms.map((term, index) => (
          // 조건에는 안정 id 가 없어 인덱스를 키로 쓴다 — 각 줄은 제어 컴포넌트라 삭제·이동으로
          // 인덱스가 밀려도 표시가 어긋나지 않는다.
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1">
              {isGateGroup(term) ? (
                <GateGroupBlock
                  value={term}
                  onChange={(next) => setTermAt(index, next)}
                  depth={depth + 1}
                  candidates={candidates}
                  makeLeaf={makeLeaf}
                />
              ) : (
                <div className="space-y-2 rounded border border-gray-200 bg-white p-2">
                  <GateLeafEditor
                    condition={term}
                    onChange={(next) => setTermAt(index, next)}
                    candidates={candidates}
                  />
                </div>
              )}
            </div>
            <TermControls
              index={index}
              count={value.terms.length}
              onMove={moveTerm}
              onRemove={removeTermAt}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addLeaf}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          조건 추가
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={addGroup}
          title="다른 결합 방식을 섞으려면 하위 묶음을 넣고 그 안에서 묶습니다"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          하위 묶음 추가
        </Button>
      </div>
    </div>
  );
}

interface GateLeafEditorProps {
  condition: CellEnableLeafCondition;
  onChange: (next: CellEnableLeafCondition) => void;
  candidates: ControllerCandidate[];
  /** 묶음 없이 이 조건 하나가 활성 조건 전체인가 — 안내 문구가 달라진다. */
  standalone?: boolean;
}

/** 조건 한 줄 — 컨트롤러 선택 + 컨트롤러 타입에 맞는 판정. */
function GateLeafEditor({ condition, onChange, candidates, standalone }: GateLeafEditorProps) {
  // 한 화면에 조건이 여러 줄이면 라디오 그룹 이름이 겹친다 — 줄마다 고유하게 둔다.
  const inputKindName = useId();
  const controller = candidates.find((c) => c.cell.id === condition.controllerCellId)?.cell;

  const handleControllerChange = (id: string) => {
    const next = candidates.find((c) => c.cell.id === id)?.cell;
    if (next) onChange(defaultConditionFor(next));
  };

  const toggleOptionValue = (key: string) => {
    if (condition.kind !== 'option') return;
    const values = condition.values.includes(key)
      ? condition.values.filter((v) => v !== key)
      : [...condition.values, key];
    onChange({ ...condition, values });
  };

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 text-gray-600">컨트롤러</span>
        <select
          value={condition.controllerCellId}
          onChange={(e) => handleControllerChange(e.target.value)}
          aria-label="컨트롤러"
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
              {standalone
                ? '옵션을 하나 이상 선택하세요 — 선택이 없으면 이 셀은 항상 비활성입니다.'
                : '옵션을 하나 이상 선택하세요 — 선택이 없으면 이 조건은 충족될 수 없습니다.'}
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
              name={inputKindName}
              checked={condition.kind === 'filled'}
              onChange={() => onChange({ kind: 'filled', controllerCellId: controller.id })}
              className="h-4 w-4"
            />
            <span>값이 있으면 활성</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={inputKindName}
              checked={condition.kind === 'numeric'}
              onChange={() =>
                onChange({
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
                  onChange({
                    ...condition,
                    op: e.target.value as typeof condition.op,
                  })
                }
                aria-label="비교 연산자"
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
                onChange={(e) => onChange({ ...condition, value: Number(e.target.value) || 0 })}
                aria-label="비교 값"
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
