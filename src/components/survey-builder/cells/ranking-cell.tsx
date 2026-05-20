'use client';

import React, { useMemo } from 'react';

import { RankingDropdownStack } from '@/components/survey-response/ranking-dropdown-stack';
import type { RankingAnswer } from '@/types/survey';
import { parseRankingAnswers } from '@/utils/ranking-shared';

import { CellContentLayout } from './cell-content-layout';
import type { InteractiveCellProps } from './types';

/** 순위형 셀 (인터랙티브) — Case 3: 테이블 셀 내부 랭킹. RankingDropdownStack 재사용. */
export const RankingCell = React.memo(function RankingCell({
  cell,
  cellResponse,
  onUpdateValue,
}: InteractiveCellProps) {
  const config = cell.rankingConfig;
  const options = cell.rankingOptions ?? [];
  const requestedPositions = Math.max(1, config?.positions ?? 3);
  const positions = Math.min(requestedPositions, Math.max(options.length, 1));
  const allowDuplicates = config?.allowDuplicateRanks === true;
  const allowOther = cell.allowOtherOption === true;

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
    <CellContentLayout content={cell.content} position={cell.textPosition}>
      <div className="flex w-full flex-col space-y-2">
        <RankingDropdownStack
          answers={answers}
          options={options}
          positions={positions}
          allowDuplicates={allowDuplicates}
          allowOther={allowOther}
          onChange={(next) => onUpdateValue(next)}
          columns={cell.optionsColumns}
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
