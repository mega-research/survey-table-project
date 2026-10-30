import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { AnswerChoice } from '@/lib/operations/profile-answer-choices';
import { answerColumnKey } from '@/lib/operations/profile-columns-format';
import { collectPiiCellIds } from '@/lib/survey/pii-cells';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';
import type { Question, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { tableInputCellLabels } from '@/utils/table-input-cell-labels';

const CHOICE_CELL_TYPES: readonly TableCell['type'][] = ['radio', 'select', 'checkbox'];

/** 보기 그룹이 `default` 하나뿐인가 — 여럿이면 한 열에 그룹 여럿이 섞여 후보에서 뺀다 */
function hasSingleDefaultGroup(q: Question): boolean {
  return q.choiceGroups?.length === 1 && q.choiceGroups[0]?.groupKey === 'default';
}

function cellChoices(cell: TableCell): AnswerChoice[] {
  const opts =
    cell.type === 'radio' ? cell.radioOptions : cell.type === 'checkbox' ? cell.checkboxOptions : cell.selectOptions;
  return (opts ?? []).map((o) => ({ id: o.id, value: o.value, label: o.label }));
}

/**
 * 응답 내역 응답값 열 후보 — 지금 빌더 구조(내보내기용으로 준비한 문항)에서 만든다.
 *
 * - 단답형·장문형 문항, 표 입력 칸: 적은 글자를 그대로 보인다.
 * - 단일·복수·드롭다운 문항(보기를 표로 그린 문항은 보기 그룹이 `default` 하나일 때), 표의 단일·드롭다운·
 *   체크박스 칸: 보기 글자로 보인다 — `choices` 에 그 열의 보기 목록을 싣는다. 복수 선택은 보기마다
 *   열을 나누지 않고 문항(칸) 하나에 열 하나다.
 *
 * 순서·변수명은 Raw 내보내기(generateSPSSColumns)를 따른다. 저장 키는 문항·칸 id(answerColumnKey).
 */
export function buildProfileAnswerModel(
  prepared: Question[],
  encryptedQuestionIds: ReadonlySet<string>,
): { sources: ProfileAnswerSource[]; choices: Map<string, AnswerChoice[]> } {
  const byId = new Map(prepared.map((q) => [q.id, q]));
  // 표 칸 이름 — 양식형 표는 행 이름이 비어 있어 내보내기 라벨(「 - 년도1」)로는 칸을 알아볼 수
  // 없다. 같은 행 앞 글자 칸(「(1) 기업명」)으로 부른다. 입력 칸과 선택 칸은 따로 센다.
  const inputLabels = new Map<string, string>();
  const choiceLabels = new Map<string, string>();
  const cellsById = new Map<string, TableCell>();
  // 개인정보 암호화 — 문항 단위(단답형·장문형)와 표 입력 칸 단위(응답 저장 경로와 같은 플래그).
  const encryptedCellIds = new Set<string>();
  for (const q of prepared) {
    if (q.type !== 'table') continue;
    const rows = q.tableRowsData ?? [];
    for (const [id, label] of tableInputCellLabels(rows)) inputLabels.set(id, label);
    for (const [id, label] of tableInputCellLabels(rows, CHOICE_CELL_TYPES)) choiceLabels.set(id, label);
    for (const row of rows) for (const cell of row.cells) cellsById.set(cell.id, cell);
    for (const cellId of collectPiiCellIds(q.tableRowsData)) encryptedCellIds.add(cellId);
  }

  const sources: ProfileAnswerSource[] = [];
  const choices = new Map<string, AnswerChoice[]>();
  const seen = new Set<string>();
  const add = (source: ProfileAnswerSource, list?: AnswerChoice[]) => {
    if (seen.has(source.key)) return;
    seen.add(source.key);
    sources.push(source);
    if (list) choices.set(source.key, list);
  };

  for (const col of generateSPSSColumns(prepared)) {
    const q = byId.get(col.questionId);
    if (!q) continue;
    if (col.type === 'text') {
      add({
        key: answerColumnKey(q.id),
        varName: col.spssVarName,
        questionTitle: col.questionText,
        cellLabel: null,
        encrypted: encryptedQuestionIds.has(q.id),
      });
      continue;
    }
    const isQuestionChoice =
      col.type === 'single' ||
      col.type === 'checkbox-item' ||
      ((col.type === 'choice-group' || col.type === 'choice-group-item') &&
        (q.type === 'radio' || q.type === 'checkbox') &&
        hasSingleDefaultGroup(q));
    if (isQuestionChoice) {
      add(
        {
          key: answerColumnKey(q.id),
          varName: q.questionCode ?? col.spssVarName,
          questionTitle: col.questionText,
          cellLabel: null,
          encrypted: false,
        },
        resolveChoiceOptions(q).map((o) => ({ id: o.id, value: o.value, label: o.label })),
      );
      continue;
    }
    if (col.type !== 'table-cell' || q.type !== 'table' || !col.tableCellId) continue;
    if (col.tableCellType === 'input') {
      add({
        key: answerColumnKey(q.id, col.tableCellId),
        varName: col.spssVarName,
        questionTitle: col.questionText,
        cellLabel: inputLabels.get(col.tableCellId) ?? (col.optionLabel || null),
        encrypted: encryptedCellIds.has(col.tableCellId),
      });
      continue;
    }
    const cell = cellsById.get(col.tableCellId);
    if (!cell || !CHOICE_CELL_TYPES.includes(cell.type)) continue;
    // 체크박스 칸은 보기마다 변수(`…_opt01`)가 나뉘어 있다 — 그 접미를 떼어 칸 하나의 이름으로 부른다.
    let varName = col.spssVarName;
    if (cell.type === 'checkbox' && col.optionIndex != null) {
      const opt = cell.checkboxOptions?.[col.optionIndex];
      const suffix = `_${opt?.optionCode ?? String(col.optionIndex + 1)}`;
      if (varName.endsWith(suffix)) varName = varName.slice(0, -suffix.length);
    }
    add(
      {
        key: answerColumnKey(q.id, cell.id),
        varName,
        questionTitle: col.questionText,
        cellLabel: choiceLabels.get(cell.id) ?? null,
        encrypted: false,
      },
      cellChoices(cell),
    );
  }
  return { sources, choices };
}
