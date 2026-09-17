import type { Question, TableCell, TableRow } from '@/types/survey';

import { isLastRemainingChoiceOptCell } from '@/utils/choice-source';
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
  ctx: {
    cell: TableCell;
    currentQuestionId: string;
    questions: Question[];
    /** 이 셀을 소유한 질문(표) — 설명 테이블(radio/checkbox) 판정에 쓴다. */
    ownQuestion: Question;
    /**
     * 에디터의 권위 있는 최신 행. 셀 모달은 getLatestRows 를 우선하고 없으면
     * ownQuestion.tableRowsData 로 폴백한다 (store 는 구조 편집 중 stale).
     */
    latestRows: TableRow[] | undefined;
  },
): string | null {
  const { contentType, rankingOptions, isOtherRankingCell, textContent, rankingLabel } = form;
  const { imageUrl, videoUrl } = form;

  // 설명 테이블(radio/checkbox)의 마지막 보기 옵션 셀을 다른 타입으로 바꾸면 질문의
  // 보기가 0개가 되어 질문 저장이 막힌다. 사전 차단하고 탈출 경로를 안내한다.
  if (
    ctx.cell.type === 'choice_opt' &&
    contentType !== 'choice_opt' &&
    (ctx.ownQuestion.type === 'radio' || ctx.ownQuestion.type === 'checkbox') &&
    isLastRemainingChoiceOptCell(ctx.latestRows, ctx.cell.id)
  ) {
    return '마지막 "보기 옵션" 셀은 다른 타입으로 바꿀 수 없습니다. 먼저 다른 셀을 보기 옵션으로 지정하거나, 기본 설정에서 "설명 테이블로 보기 구성"을 끄세요.';
  }

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
