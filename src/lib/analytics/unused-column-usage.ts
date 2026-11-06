/**
 * 안 쓴 열 빼기 — 「안 쓰면 내보내기에서 뺀다」(`TableColumn.exportOmitIfUnused`)를 켠 열 중
 * 응답 전체에서 아무도 채우지 않은 열을 찾는다. 내보내기가 그 열의 변수를 내지 않는다.
 *
 * 행 반복의 사용 벌 스캔(`row-repeat-usage`)과 같은 결이다 — 넉넉히 만들어 둔 칸 중 쓰인 것만
 * 내보낸다. **파일별이 아니라 설문 전체 기준**이어야 분할 내보내기의 파일 간 열 구성이 같다.
 * 열 하나는 그 열의 모든 행 칸을 본다(행 반복으로 펼친 벌 포함). 값이 있는지는
 * `hasRespondentValue` 로 판정한다 — 빈 문자열·공백과 계산 칸 값(저장 경계가 늘 넣는다)은 쓴 것이 아니다.
 *
 * 응답 화면·저장·변수명은 이 판정을 모른다. 남은 열의 이름은 빠진 열과 무관하게 그대로다.
 */
import type { Question, TableCell } from '@/types/survey';
import { hasRespondentValue } from '@/utils/table-cell-semantics';

/** 응답 한 건에서 스캔이 보는 부분 — 호출부마다 행 타입이 달라 구조만 요구한다. */
interface SubmissionLike {
  questionResponses: Record<string, unknown>;
}

type ColumnQuestion = Pick<Question, 'id' | 'tableColumns' | 'tableRowsData'>;

/**
 * 「안 쓰면 뺀다」 열 또는 행이 있는 표 문항 id — 이 목록이 비면 스캔을 건너뛴다.
 *
 * 행에도 같은 표시가 있다(`TableRow.exportOmitIfUnused`, 2026-11-06) — 조건으로 나타나는 줄을 넉넉히
 * 만들어 둔 표(유가공업 문2 수입 원료 「기타1~10」). 행 반복 벌의 미사용 벌 빼기(`row-repeat-usage`)와는 별개다.
 * 열 id 와 행 id 는 같은 결과 맵에 담긴다(둘 다 UUID 라 겹치지 않는다).
 */
export function omittableColumnQuestionIds(questions: readonly ColumnQuestion[]): string[] {
  return questions
    .filter(
      (question) =>
        (question.tableColumns ?? []).some((column) => column.exportOmitIfUnused === true) ||
        (question.tableRowsData ?? []).some((row) => row.exportOmitIfUnused === true),
    )
    .map((question) => question.id);
}

/**
 * 질문 id → 아무도 채우지 않은 「안 쓰면 뺀다」 열·행 id 집합.
 * 뺄 열이 하나도 없는 질문은 담지 않는다.
 */
export function collectUnusedColumnIds(
  questions: readonly ColumnQuestion[],
  submissions: readonly SubmissionLike[],
): Map<string, Set<string>> {
  // 질문별로 「열 id → 그 열의 칸 id 목록」을 미리 만든다
  const candidates = new Map<string, Map<string, TableCell[]>>();
  for (const question of questions) {
    const columns = question.tableColumns ?? [];
    const byColumn = new Map<string, TableCell[]>();
    columns.forEach((column, colIdx) => {
      if (column.exportOmitIfUnused !== true) return;
      const cells: TableCell[] = [];
      for (const row of question.tableRowsData ?? []) {
        const cell = row.cells[colIdx];
        if (cell && !cell.isHidden) cells.push(cell);
      }
      byColumn.set(column.id, cells);
    });
    // 「안 쓰면 뺀다」 행 — 그 행의 모든 칸을 본다(열과 같은 판정, 키는 행 id)
    for (const row of question.tableRowsData ?? []) {
      if (row.exportOmitIfUnused !== true) continue;
      byColumn.set(
        row.id,
        row.cells.filter((cell) => !cell.isHidden),
      );
    }
    if (byColumn.size > 0) candidates.set(question.id, byColumn);
  }

  const unused = new Map<string, Set<string>>();
  for (const [questionId, byColumn] of candidates) {
    const remaining = new Set(byColumn.keys());
    for (const submission of submissions) {
      if (remaining.size === 0) break;
      const answer = submission.questionResponses?.[questionId];
      if (typeof answer !== 'object' || answer === null) continue;
      const cellValues = answer as Record<string, unknown>;
      for (const columnId of [...remaining]) {
        if (byColumn.get(columnId)!.some((cell) => hasRespondentValue(cell, cellValues))) remaining.delete(columnId);
      }
    }
    if (remaining.size > 0) unused.set(questionId, remaining);
  }
  return unused;
}
