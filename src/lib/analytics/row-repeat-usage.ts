/**
 * 반복 블록의 "쓰인 벌" 스캔 — 내보내기에서 뒤쪽 미사용 벌의 열을 빼기 위한 판정.
 *
 * 구조에는 최대 20벌이 박혀 있지만 실제로 3벌까지만 쓰였다면 r04 이후는 빈 열이다.
 * 설문 전체 응답을 1회 훑어 반복 블록별 최대 사용 벌을 구한다 — **파일별이 아니라
 * 설문 전체 기준**이어야 분할 내보내기의 파일 간 열 구성이 갈리지 않는다.
 *
 * 1벌은 아무도 채우지 않았어도 항상 낸다 (문항이 있었다는 사실 자체가 기록이다).
 */
import { repeatIndexOf } from '@/lib/question/row-repeat';
import type { Question } from '@/types/survey';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

/** 질문 id → 실제로 값이 들어간 최대 벌 번호 (반복 블록이 있는 질문만 담긴다) */
export type UsedRepeatCounts = ReadonlyMap<string, number>;

interface SubmissionLike {
  questionResponses: Record<string, unknown>;
}

export function collectUsedRepeatCounts(
  questions: readonly Pick<Question, 'id' | 'tableRowsData'>[],
  submissions: readonly SubmissionLike[],
): Map<string, number> {
  const used = new Map<string, number>();

  // 반복 행을 가진 질문만 대상 — 벌 번호별 셀 id 목록을 미리 만든다.
  const bundleCellsByQuestion = new Map<string, Map<number, string[]>>();
  for (const question of questions) {
    const byBundle = new Map<number, string[]>();
    for (const row of question.tableRowsData ?? []) {
      const bundle = repeatIndexOf(row);
      if (bundle === undefined) continue;
      const ids = byBundle.get(bundle) ?? [];
      for (const cell of row.cells) ids.push(cell.id);
      byBundle.set(bundle, ids);
    }
    if (byBundle.size === 0) continue;
    bundleCellsByQuestion.set(question.id, byBundle);
    used.set(question.id, 1);
  }
  if (bundleCellsByQuestion.size === 0) return used;

  for (const submission of submissions) {
    for (const [questionId, byBundle] of bundleCellsByQuestion) {
      const answer = submission.questionResponses?.[questionId];
      if (typeof answer !== 'object' || answer === null) continue;
      const cellValues = answer as Record<string, unknown>;
      let max = used.get(questionId) ?? 1;
      for (const [bundle, cellIds] of byBundle) {
        if (bundle <= max) continue;
        if (cellIds.some((id) => isCellValuePresent(cellValues[id]))) max = bundle;
      }
      used.set(questionId, max);
    }
  }

  return used;
}
