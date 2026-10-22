import type { Question } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import { isChoiceTableSource } from '@/utils/choice-source';
import {
  collectProjectedCellIds,
  projectResponseTableLayout,
} from '@/utils/conditional-table-layout';
import { getDynamicRowSelections } from '@/utils/dynamic-row-selection-sidecar';

import { CHOICE_GROUPS_KEY } from './choice-selection';

/**
 * 보기를 표로 그리는 문항에서 **지금 응답자에게 보이지 않는 칸** 판정.
 *
 * 대상은 표 문항과 보기 소스 표(radio·checkbox)다. 숨김의 원인은 셋 — 행 표시조건, 열 표시조건,
 * 고르지 않은 동적 행. 투영은 렌더러와 같은 `projectResponseTableLayout` 이다(규칙은 그 주석).
 *
 * 숨은 칸을 가리키는 선택은 답이 아니다 — 필수·최소 선택·단독 보기를 채우지 않고, 최대 선택에
 * 세지 않으며, 저장 경계에서 지운다(`stripHiddenQuestionValues`). 순위형 표 소스는 대상이 아니다 —
 * 순위형 렌더러가 조건을 적용하지 않고, 빌더도 순위형 표에는 행·열 조건과 동적 행을 막는다.
 */

/** 표로 그리는 문항인가 — 순위형은 뺀다(위 주석). */
function isResponseTableQuestion(question: Question): boolean {
  if (question.type === 'table') return true;
  return (
    (question.type === 'radio' || question.type === 'checkbox') && isChoiceTableSource(question)
  );
}

/**
 * 숨김이 생길 수 있는 표인가 — 행·열 표시조건이나 켜진 동적 그룹의 행이 하나라도 있으면.
 * 아니면 판정 자체를 건너뛴다(대다수 문항) — 투영 비용도, 동작 변화도 없다.
 */
function canHideCells(question: Question): boolean {
  const rows = question.tableRowsData ?? [];
  if (rows.some((row) => row.displayCondition)) return true;
  if ((question.tableColumns ?? []).some((column) => column.displayCondition)) return true;
  const enabledGroupIds = new Set(
    (question.dynamicRowConfigs ?? []).filter((c) => c.enabled).map((c) => c.groupId),
  );
  return rows.some((row) => row.dynamicGroupId && enabledGroupIds.has(row.dynamicGroupId));
}

/**
 * 동적 행 선택 — 표 문항은 표 응답 안 `__selectedRowIds`, 보기 소스 표는 루트 사이드카.
 * 보기 소스 표는 문항 값이 선택 셀 id 라 그 안에 둘 자리가 없다.
 */
function readSelectedDynamicRowIds(
  question: Question,
  allResponses: Record<string, unknown>,
): string[] {
  if (question.type !== 'table') return getDynamicRowSelections(allResponses, question.id);
  const value = allResponses[question.id];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>)['__selectedRowIds'];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export interface TableCellVisibility {
  /** 그려지는 칸 id */
  visibleCellIds: ReadonlySet<string>;
  /** 작성된(병합으로 덮이지 않은) 칸 중 지금 숨은 칸 id */
  hiddenCellIds: ReadonlySet<string>;
}

/**
 * 표의 보이는 칸·숨은 칸. 표로 그리는 문항이 아니거나 숨김이 생길 수 없는 표면 null.
 *
 * `evalCtx` 는 렌더러와 같은 것을 넘긴다(`responsesToLookupShape(allResponses)` + 명단 attrs +
 * 참조표) — 빠뜨리면 attr·lookup 조건이 조용히 다른 값으로 평가된다(2026-09-08 사고).
 *
 * 숨은 칸에는 작성 단계에서 병합으로 덮인 칸(`isHidden`)을 넣지 않는다 — 조건과 무관하게 원래
 * 그려지지 않는 칸이라 여기서 지울 대상이 아니다.
 */
export function resolveTableCellVisibility(
  question: Question,
  allResponses: Record<string, unknown>,
  allQuestions: Question[],
  evalCtx?: BranchEvalCtx,
): TableCellVisibility | null {
  if (!isResponseTableQuestion(question) || !canHideCells(question)) return null;
  const rows = question.tableRowsData ?? [];
  const layout = projectResponseTableLayout({
    columns: question.tableColumns ?? [],
    rows,
    ...(question.tableHeaderGrid ? { headerGrid: question.tableHeaderGrid } : {}),
    dynamicRowConfigs: question.dynamicRowConfigs,
    selectedDynamicRowIds: readSelectedDynamicRowIds(question, allResponses),
    allResponses,
    allQuestions,
    evalCtx,
  });
  const visibleCellIds = collectProjectedCellIds(layout.rows);
  const hiddenCellIds = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell.isHidden && !visibleCellIds.has(cell.id)) hiddenCellIds.add(cell.id);
    }
  }
  return { visibleCellIds, hiddenCellIds };
}

/** 그룹 선택 맵에서 숨은 칸을 뺀다. 그룹이 비면 키째 뺀다. 뺄 것이 없으면 null. */
function dropHiddenGroupSelections(
  raw: unknown,
  hiddenCellIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [groupKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && hiddenCellIds.has(value)) {
      changed = true;
      continue;
    }
    if (Array.isArray(value)) {
      const kept = value.filter((id) => !(typeof id === 'string' && hiddenCellIds.has(id)));
      if (kept.length !== value.length) {
        changed = true;
        if (kept.length > 0) next[groupKey] = kept;
        continue;
      }
    }
    next[groupKey] = value;
  }
  return changed ? next : null;
}

/**
 * 문항 값에서 숨은 칸을 가리키는 **선택**을 뺀 값 — 검증과 strip 이 같이 쓴다.
 *
 * - 보기 소스 radio: `셀 id` → 숨은 칸이면 undefined
 * - 보기 소스 checkbox: `셀 id[]` → 숨은 칸을 뺀 배열, 다 빠지면 undefined
 * - 보기 그룹(radio·checkbox): `{그룹키: 셀 id | 셀 id[]}` → 숨은 칸을 뺀 맵, 다 빠지면 undefined
 * - 표 문항: 숨은 칸의 셀 값 키와 `__choiceGroups` 안 선택을 뺀다. `__selectedRowIds` 같은 다른
 *   예약 키는 그대로 둔다.
 *
 * 뺄 것이 없으면 입력 참조를 그대로 돌려준다. 기타 상세기재 사이드카(`__optTexts__`)는 문항 값
 * 밖이라 여기서 다루지 않는다 — strip 이 따로 지운다.
 */
export function dropHiddenTableSelections(
  question: Question,
  value: unknown,
  hiddenCellIds: ReadonlySet<string>,
): unknown {
  if (hiddenCellIds.size === 0 || value === undefined || value === null) return value;

  if (question.type === 'table') {
    if (typeof value !== 'object' || Array.isArray(value)) return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, cellValue] of Object.entries(value as Record<string, unknown>)) {
      if (hiddenCellIds.has(key)) {
        changed = true;
        continue;
      }
      if (key === CHOICE_GROUPS_KEY) {
        const stripped = dropHiddenGroupSelections(cellValue, hiddenCellIds);
        if (stripped) {
          changed = true;
          next[key] = stripped;
          continue;
        }
      }
      next[key] = cellValue;
    }
    return changed ? next : value;
  }

  if (typeof value === 'string') return hiddenCellIds.has(value) ? undefined : value;
  if (Array.isArray(value)) {
    const kept = value.filter((id) => !(typeof id === 'string' && hiddenCellIds.has(id)));
    if (kept.length === value.length) return value;
    return kept.length > 0 ? kept : undefined;
  }
  if (typeof value === 'object') {
    const stripped = dropHiddenGroupSelections(value, hiddenCellIds);
    if (!stripped) return value;
    return Object.keys(stripped).length > 0 ? stripped : undefined;
  }
  return value;
}

/**
 * 보이는 칸 집합 밖의 선택을 뺀 값 — 필수 판정처럼 보이는 칸 집합만 받는 자리용.
 *
 * 빼는 것은 **이 표의 칸이면서 보이지 않는 칸**을 가리키는 선택뿐이다. 표에 없는 id(구버전 잔재 등)는
 * 숨김 판정의 소관이 아니라 그대로 둔다. 집합이 없으면 입력 그대로다.
 */
export function dropSelectionsOutsideVisibleCells(
  question: Question,
  value: unknown,
  visibleCellIds: ReadonlySet<string> | undefined,
): unknown {
  if (!visibleCellIds) return value;
  return dropHiddenTableSelections(question, value, cellIdsOutside(question, visibleCellIds));
}

/** 보기 그룹 선택 맵 하나에서 보이는 칸 집합 밖의 선택을 뺀다 — 표 문항 응답 안 `__choiceGroups` 용. */
export function dropGroupSelectionsOutsideVisibleCells(
  question: Question,
  map: Record<string, unknown>,
  visibleCellIds: ReadonlySet<string> | undefined,
): Record<string, unknown> {
  if (!visibleCellIds) return map;
  return dropHiddenGroupSelections(map, cellIdsOutside(question, visibleCellIds)) ?? map;
}

function cellIdsOutside(question: Question, visibleCellIds: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  for (const row of question.tableRowsData ?? []) {
    for (const cell of row.cells) if (!visibleCellIds.has(cell.id)) hidden.add(cell.id);
  }
  return hidden;
}
