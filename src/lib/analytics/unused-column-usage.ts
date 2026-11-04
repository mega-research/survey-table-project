/**
 * 안 쓴 열 빼기 — 「안 쓰면 내보내기에서 뺀다」(`TableColumn.exportOmitIfUnused`)를 켠 열 중
 * 응답 전체에서 아무도 채우지 않은 열을 찾는다. 내보내기가 그 열의 변수를 내지 않는다.
 *
 * 행 반복의 사용 벌 스캔(`row-repeat-usage`)과 같은 결이다 — 넉넉히 만들어 둔 칸 중 쓰인 것만
 * 내보낸다. **파일별이 아니라 설문 전체 기준**이어야 분할 내보내기의 파일 간 열 구성이 같다.
 * 열 하나는 그 열의 모든 행 칸을 본다(행 반복으로 펼친 벌 포함). 값이 있는지는
 * `isCellValuePresent` 로 판정한다 — 빈 문자열·공백은 쓴 것이 아니다.
 *
 * 응답 화면·저장·변수명은 이 판정을 모른다. 남은 열의 이름은 빠진 열과 무관하게 그대로다.
 */
import type { Question } from '@/types/survey';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

/** 응답 한 건에서 스캔이 보는 부분 — 호출부마다 행 타입이 달라 구조만 요구한다. */
interface SubmissionLike {
  questionResponses: Record<string, unknown>;
}

type ColumnQuestion = Pick<Question, 'id' | 'tableColumns' | 'tableRowsData'>;

/** 「안 쓰면 뺀다」 열이 있는 표 문항 id — 이 목록이 비면 스캔을 건너뛴다. */
export function omittableColumnQuestionIds(questions: readonly ColumnQuestion[]): string[] {
  return questions
    .filter((question) => (question.tableColumns ?? []).some((column) => column.exportOmitIfUnused === true))
    .map((question) => question.id);
}

/**
 * 질문 id → 아무도 채우지 않은 「안 쓰면 뺀다」 열 id 집합.
 * 뺄 열이 하나도 없는 질문은 담지 않는다.
 */
export function collectUnusedColumnIds(
  questions: readonly ColumnQuestion[],
  submissions: readonly SubmissionLike[],
): Map<string, Set<string>> {
  // 질문별로 「열 id → 그 열의 칸 id 목록」을 미리 만든다
  const candidates = new Map<string, Map<string, string[]>>();
  for (const question of questions) {
    const columns = question.tableColumns ?? [];
    const byColumn = new Map<string, string[]>();
    columns.forEach((column, colIdx) => {
      if (column.exportOmitIfUnused !== true) return;
      const cellIds: string[] = [];
      for (const row of question.tableRowsData ?? []) {
        const cell = row.cells[colIdx];
        if (cell && !cell.isHidden) cellIds.push(cell.id);
      }
      byColumn.set(column.id, cellIds);
    });
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
        if (byColumn.get(columnId)!.some((id) => isCellValuePresent(cellValues[id]))) remaining.delete(columnId);
      }
    }
    if (remaining.size > 0) unused.set(questionId, remaining);
  }
  return unused;
}
