import type { ChoiceGroup, Question, TableCell } from '@/types/survey';
import { collectChoiceOptCells } from '@/utils/choice-source';

/** 그룹 미소속 choice_opt 셀의 예약 응답 키. export 변수명은 질문코드 그대로(하위호환). */
export const DEFAULT_GROUP_KEY = 'default';

/**
 * 그룹별 응답 맵 shape:
 * - radio 그룹 키 → 선택 cellId (string)
 * - checkbox 그룹 키 → 선택 cellId 배열 (string[])
 */
export type GroupedChoiceAnswer = Record<string, string | string[]>;

/**
 * 이 질문의 응답이 그룹별 맵 shape인지 — 모든 경로(렌더/검증/분기/export)의
 * 하위호환 분기점. radio 또는 checkbox 그룹이 1개 이상 정의된 경우 true.
 * ranking 그룹은 제외한다 (4b-3 에서 별도 처리).
 */
export function isGroupedChoiceQuestion(question: Question): boolean {
  return (question.choiceGroups ?? []).some(
    (g) => g.type === 'radio' || g.type === 'checkbox',
  );
}

/** 셀이 속한 그룹의 groupKey. 미소속/깨진 참조는 default로 폴백. */
export function getGroupKeyOfCell(question: Question, cellId: string): string {
  const cell = collectChoiceOptCells(question.tableRowsData).find((c) => c.id === cellId);
  if (!cell?.choiceGroupId) return DEFAULT_GROUP_KEY;
  const group = (question.choiceGroups ?? []).find((g) => g.id === cell.choiceGroupId);
  return group?.groupKey ?? DEFAULT_GROUP_KEY;
}

/**
 * 셀이 속한 그룹의 type. 미소속/깨진 참조는 질문 type 기반 default 규칙:
 * 질문 type이 'checkbox'이면 'checkbox', 그 외는 'radio'.
 */
export function getGroupTypeOfCell(question: Question, cellId: string): 'radio' | 'checkbox' {
  const defaultType = question.type === 'checkbox' ? 'checkbox' : 'radio';
  const cell = collectChoiceOptCells(question.tableRowsData).find((c) => c.id === cellId);
  if (!cell?.choiceGroupId) return defaultType;
  const group = (question.choiceGroups ?? []).find((g) => g.id === cell.choiceGroupId);
  if (!group) return defaultType;
  // ranking 그룹에 소속된 셀도 default 규칙으로 폴백
  if (group.type === 'ranking') return defaultType;
  return group.type;
}

export interface ChoiceGroupWithCells {
  groupKey: string;
  label: string;
  /** 그룹의 응답 동작: radio=단일 선택, checkbox=복수 선택 */
  type: 'radio' | 'checkbox';
  cells: TableCell[];
}

/**
 * 질문의 radio·checkbox 그룹들을 멤버 셀과 함께 반환한다 (정의 순).
 * - ranking 그룹은 skip.
 * - 멤버 0 그룹은 skip (prune을 비껴간 phantom 그룹 무해화).
 * - 미소속 choice_opt 셀이 있으면 default 그룹을 마지막에 추가한다.
 *   default 그룹의 type은 질문 type이 'checkbox'이면 'checkbox', 그 외 'radio'.
 */
export function collectChoiceGroups(question: Question): ChoiceGroupWithCells[] {
  const allCells = collectChoiceOptCells(question.tableRowsData);
  const groups: ChoiceGroupWithCells[] = [];
  const claimed = new Set<string>();

  for (const group of question.choiceGroups ?? []) {
    // ranking 그룹은 collectChoiceGroups 대상에서 제외
    if (group.type === 'ranking') continue;
    const cells = allCells.filter((c) => c.choiceGroupId === group.id);
    // 멤버 0 그룹은 응답 불가능한 요구가 되므로 제외한다 — 행/열 삭제 등으로
    // prune 을 비껴간 phantom 그룹(이미 snapshot 에 박힌 것 포함)을 무해화.
    if (cells.length === 0) continue;
    for (const c of cells) claimed.add(c.id);
    groups.push({ groupKey: group.groupKey, label: group.label, type: group.type, cells });
  }

  const orphans = allCells.filter((c) => !claimed.has(c.id));
  if (orphans.length > 0) {
    const defaultType = question.type === 'checkbox' ? 'checkbox' : 'radio';
    groups.push({ groupKey: DEFAULT_GROUP_KEY, label: '', type: defaultType, cells: orphans });
  }
  return groups;
}

const KEY_PREFIX: Record<ChoiceGroup['type'], string> = {
  radio: 'rad',
  checkbox: 'cb',
  ranking: 'rnk',
};

/** 그룹 키 자동 발번: 같은 종류의 최대 순번 + 1 (rad1, rad2 ...) */
export function nextGroupKey(groups: ChoiceGroup[], type: ChoiceGroup['type']): string {
  const prefix = KEY_PREFIX[type];
  let max = 0;
  for (const g of groups) {
    const m = g.groupKey.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * 멤버 0 그룹을 제거한 choiceGroups를 반환한다 (저장 시 자동 정리 — 삭제 UI 없음).
 * 변경 없으면 원본 참조 유지, choiceGroups 자체가 없으면 undefined.
 */
export function pruneChoiceGroups(question: Question): ChoiceGroup[] | undefined {
  const groups = question.choiceGroups;
  if (!groups) return undefined;
  const memberIds = new Set(
    collectChoiceOptCells(question.tableRowsData)
      .map((c) => c.choiceGroupId)
      .filter((id): id is string => !!id),
  );
  const pruned = groups.filter((g) => memberIds.has(g.id));
  return pruned.length === groups.length ? groups : pruned;
}
