import type { Question, TableCell } from '@/types/survey';

import { hasExistingOtherRankingCell } from '@/utils/ranking-source';
import type { UseCellFormResult } from './hooks/use-cell-form';

/**
 * 셀 편집 저장 전 빌더 검증 — 위반 시 사용자에게 보일 문구, 통과면 null.
 *
 * 순수 함수다. 토스트를 띄우거나 저장을 중단하는 것은 호출부가 정한다 — 그래야 규칙만
 * 따로 테스트할 수 있다(이 규칙들은 모달 안에 있는 동안 테스트가 닿지 못했다).
 */
export function validateCellEdit(
  form: UseCellFormResult['form'],
  ctx: { cell: TableCell; currentQuestionId: string; questions: Question[] },
): string | null {
  const { contentType, rankingOptions, isOtherRankingCell, textContent, rankingLabel } = form;
  const { imageUrl, videoUrl } = form;

  // 순위형 셀은 옵션이 최소 1개 이상이어야 한다.
  if (contentType === 'ranking' && rankingOptions.length === 0) {
    return '순위형 셀은 최소 1개 이상의 옵션이 필요합니다.';
  }

  // ranking_opt 셀은 content/rankingLabel/imageUrl/videoUrl 중 하나 이상 필요.
  // 단, "기타로 사용" 셀은 드롭다운 라벨이 자동 폴백(기타 (직접 입력))되므로 빈 상태도 허용.
  if (contentType === 'ranking_opt' && !isOtherRankingCell) {
    const hasContent = !!(
      textContent.trim() ||
      rankingLabel.trim() ||
      imageUrl.trim() ||
      videoUrl.trim()
    );
    if (!hasContent) {
      return '순위 옵션 소스 셀은 텍스트/라벨/이미지/비디오 중 하나 이상을 설정해야 합니다.';
    }
  }

  // 같은 질문 내 기타 ranking_opt 셀이 이미 존재하면 차단 (자기 자신은 제외).
  if (contentType === 'ranking_opt' && isOtherRankingCell) {
    const hostQuestion = ctx.questions.find((q) => q.id === ctx.currentQuestionId);
    if (hasExistingOtherRankingCell(hostQuestion?.tableRowsData, ctx.cell.id)) {
      return '이 질문에는 이미 "기타"로 지정된 순위 옵션 셀이 있습니다. 질문당 최대 1개만 지정할 수 있습니다.';
    }
  }

  return null;
}
