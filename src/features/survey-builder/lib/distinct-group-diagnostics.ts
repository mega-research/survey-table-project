/**
 * 중복 불가 묶음 빌더 경고 — 이름만 적어 두고 동작하지 않는 설정을 셀 편집 모달이 알린다.
 *
 * 응답 화면은 조용히 "아무것도 막지 않는다" — 묶음에 칸이 하나뿐이거나, 칸마다 보기 값(코드)이
 * 달라 같은 보기로 볼 것이 없으면 그렇다. 설정이 잘못됐다는 신호는 여기서만 난다.
 */
import type { QuestionOption, TableRow } from '@/types/survey';

export type DistinctGroupWarning =
  /** 같은 이름의 다른 선택 칸이 없다 */
  | 'alone'
  /** 구성원은 있는데 보기 값이 하나도 겹치지 않는다 */
  | 'no-shared-options';

export const DISTINCT_GROUP_WARNING_MESSAGES: Record<DistinctGroupWarning, string> = {
  alone:
    '이 이름을 쓰는 다른 선택 칸이 아직 없습니다. 같은 이름을 가진 선택 칸이 둘 이상이어야 중복을 막습니다.',
  'no-shared-options':
    '같은 묶음의 다른 칸과 겹치는 보기가 없습니다. 보기 값(코드)이 같아야 같은 보기로 봅니다.',
};

/** 선택 칸이 응답으로 쓰는 보기 키 — 응답 화면·검증과 같은 규칙(`value ?? id`). */
function optionKeys(options: readonly QuestionOption[] | undefined): Set<string> {
  return new Set((options ?? []).map((option) => option.value ?? option.id));
}

export function diagnoseDistinctGroup(input: {
  /** 표의 현재 행 (편집 중인 칸의 저장 전 상태를 담고 있어도 된다 — 그 칸은 폼 값으로 본다) */
  rows: readonly TableRow[];
  /** 편집 중인 칸 */
  cellId: string;
  /** 폼의 묶음 이름 */
  name: string;
  /** 폼의 보기 목록 */
  selectOptions: readonly QuestionOption[];
  /** 「같은 열의 다른 선택 칸에도 적용」 체크 */
  applyToColumn: boolean;
}): DistinctGroupWarning | null {
  const name = input.name.trim();
  if (!name) return null;

  const column = input.applyToColumn
    ? input.rows.reduce(
        (found, row) =>
          found !== -1 ? found : row.cells.findIndex((cell) => cell.id === input.cellId),
        -1,
      )
    : -1;

  const peers = input.rows.flatMap((row) =>
    row.cells.filter((cell, index) => {
      if (cell.id === input.cellId || cell.type !== 'select' || cell.isHidden) return false;
      return cell.distinctGroup?.trim() === name || index === column;
    }),
  );
  if (peers.length === 0) return 'alone';

  const own = optionKeys(input.selectOptions);
  const shares = peers.some((peer) =>
    [...optionKeys(peer.selectOptions)].some((key) => own.has(key)),
  );
  return shares ? null : 'no-shared-options';
}
