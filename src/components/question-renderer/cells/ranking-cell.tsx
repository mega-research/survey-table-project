'use client';

/* eslint-disable jsx-a11y/role-supports-aria-props -- aria-invalid 전역 상태를 복수 순위 입력의 검증 그룹에 연결한다. */

import React, { useMemo } from 'react';

import { RankingDropdownStack } from '@/components/question-renderer/ranking-dropdown-stack';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { RankingAnswer } from '@/types/survey';
import { parseRankingAnswers } from '@/utils/ranking-shared';

import { CellContentLayout } from './cell-content-layout';
import type { InteractiveCellProps } from './types';

/** 순위형 셀 (인터랙티브) — Case 3: 테이블 셀 내부 랭킹. RankingDropdownStack 재사용. */
export const RankingCell = React.memo(function RankingCell({
  cell,
  cellResponse,
  onUpdateValue,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
}: InteractiveCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const config = cell.rankingConfig;
  const options = cell.rankingOptions ?? [];
  const requestedPositions = Math.max(1, config?.positions ?? 3);
  const positions = Math.min(requestedPositions, Math.max(options.length, 1));
  const allowDuplicates = config?.allowDuplicateRanks === true;

  const answers = useMemo<RankingAnswer[]>(
    () => parseRankingAnswers(cellResponse),
    [cellResponse],
  );

  if (options.length === 0) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-xs">순위 옵션 없음</span>
      </div>
    );
  }

  return (
    <CellContentLayout
      content={substituteTokens(cell.content, attrs, quotes)}
      position={cell.textPosition}
      bold={cell.textBold}
      textColor={cell.textColor}
    >
      <div
        id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
        className="flex w-full flex-col space-y-2"
        role="group"
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
      >
        <RankingDropdownStack
          answers={answers}
          options={options}
          positions={positions}
          allowDuplicates={allowDuplicates}
          allowOther={false}
          onChange={(next) => onUpdateValue(next)}
          inputIdScope={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
          {...(cell.optionsColumns !== undefined ? { columns: cell.optionsColumns } : {})}
          detailTargetScopeId={cell.id}
          compact
        />
        {positions < requestedPositions && (
          <p className="text-xs text-gray-500">
            선택지 {options.length}개 → 최대 {positions}순위
          </p>
        )}
      </div>
    </CellContentLayout>
  );
});
