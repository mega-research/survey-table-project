import type { ChoiceGroup, TableRow } from '@/types/survey';
import { REQUIRED_CELL_TYPES } from '@/utils/serialize-cell';

/**
 * 필수 마스터 전파 (ADR 0021) — 질문 레벨 "필수 질문" 토글 조작 시점의 일괄 복사.
 * 상속·파생이 아니라 조작 순간에만 명시값을 기록한다: 발행된 설문에 소급하지 않고,
 * 이후 셀·그룹 개별 수정이 토글보다 우선한다. ON/OFF 대칭.
 */

/**
 * 표의 인터랙티브 셀(input/radio/checkbox/select/ranking)에 필수를 일괄 기록한다.
 * - 게이팅(enabledWhen) 셀은 "활성일 때 필수"(requiredWhenEnabled)로 켠다 — 게이팅 셀의
 *   필수는 이 하나로 수렴한다는 기존 결정(CONTEXT.md 셀 게이팅) 유지. OFF 대칭을 위해
 *   평범한 required 는 항상 false 로 정리한다.
 * - 셀별 안내 문구(requiredMessage)는 보존한다.
 * - 비인터랙티브 셀(text/image/video/calc/choice_opt/ranking_opt)은 건드리지 않는다.
 */
export function propagateRequiredToTableRows(rows: TableRow[], on: boolean): TableRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      if (!REQUIRED_CELL_TYPES.has(cell.type)) return cell;
      if (cell.enabledWhen) {
        return { ...cell, requiredWhenEnabled: on, required: false };
      }
      return { ...cell, required: on };
    }),
  }));
}

/**
 * 보기 옵션 그룹의 명시 required 오버라이드를 제거해 질문 레벨 상속으로 복귀시킨다.
 * (그룹 필수는 `그룹.required ?? 질문.required` 파생이므로, 오버라이드만 지우면
 * 토글 ON=전 그룹 ON / OFF=전 그룹 OFF 가 된다.) 그룹별 안내 문구는 보존.
 */
export function stripChoiceGroupRequiredOverrides(groups: ChoiceGroup[]): ChoiceGroup[] {
  return groups.map((group) => {
    if (group.required === undefined) return group;
    const { required: _required, ...rest } = group;
    return rest;
  });
}
