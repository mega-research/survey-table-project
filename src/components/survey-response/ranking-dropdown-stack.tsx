'use client';

import { Fragment } from 'react';

import { Input } from '@/components/ui/input';
import type { QuestionOption, RankingAnswer } from '@/types/survey';
import { getOptionsLayout } from '@/utils/options-layout';
import {
  RANKING_HORIZONTAL_ITEM_WIDTH,
  RANKING_OTHER_VALUE,
  RANKING_SELECT_BASE_CLS,
  RANKING_SELECT_FOCUS_CLS,
} from '@/utils/ranking-shared';

export interface RankingDropdownStackProps {
  /** 현재 응답 (RankingAnswer[]). parseRankingAnswers 로 정규화된 값 권장. */
  answers: RankingAnswer[];
  /** 선택지 목록 (Case 1/2/3 공통). */
  options: QuestionOption[];
  /** 렌더할 순위 개수. options.length 초과하지 않도록 상위에서 clamp. */
  positions: number;
  /** 같은 옵션을 여러 순위에 선택 허용할지. false 면 이미 선택된 값은 disabled. */
  allowDuplicates: boolean;
  /** '기타 (직접 입력)' 옵션 허용 여부. */
  allowOther: boolean;
  /** 응답 변경 콜백 (rank 기준 오름차순 정렬된 RankingAnswer[]). */
  onChange: (next: RankingAnswer[]) => void;
  /** 셀 컨텍스트처럼 좁은 영역에 렌더할 때 compact 스타일 적용. */
  compact?: boolean;
  /** 순위 드롭다운 배치 (undefined/1=세로, 0=가로, N≥2=N열 그리드). compact 와 독립. */
  columns?: number;
}

/**
 * 순위형 응답의 드롭다운 스택.
 * ranking-question (Case 1/2) / cells/ranking-cell (Case 3) 가 공유.
 */
export function RankingDropdownStack({
  answers,
  options,
  positions,
  allowDuplicates,
  allowOther,
  onChange,
  compact = false,
  columns,
}: RankingDropdownStackProps) {
  const answerAt = (rank: number) => answers.find((a) => a.rank === rank);
  const selectedValueAt = (rank: number) => answerAt(rank)?.optionValue ?? '';
  const otherTextAt = (rank: number) => answerAt(rank)?.otherText ?? '';
  const optionTextAt = (rank: number) => answerAt(rank)?.optionText ?? '';

  const commit = (next: RankingAnswer[]) => {
    onChange(next.sort((a, b) => a.rank - b.rank));
  };

  const handleSelect = (rank: number, newValue: string) => {
    const filtered = answers.filter((a) => a.rank !== rank);
    if (!newValue) {
      commit(filtered);
      return;
    }
    const entry: RankingAnswer = { rank, optionValue: newValue };
    if (newValue === RANKING_OTHER_VALUE) {
      // __other__ 매직값: otherText 유지 (호환)
      entry.otherText = otherTextAt(rank);
    } else {
      // allowTextInput 옵션: 이전 optionText 유지 (선택 해제 시에도 값 보존)
      const prevOptionText = optionTextAt(rank);
      if (prevOptionText) entry.optionText = prevOptionText;
    }
    commit([...filtered, entry]);
  };

  const handleOtherText = (rank: number, text: string) => {
    const current = answerAt(rank);
    if (!current) return;
    const filtered = answers.filter((a) => a.rank !== rank);
    commit([...filtered, { ...current, otherText: text }]);
  };

  const handleOptionText = (rank: number, text: string) => {
    const current = answerAt(rank);
    if (!current) return;
    const filtered = answers.filter((a) => a.rank !== rank);
    commit([...filtered, { ...current, optionText: text }]);
  };

  const isTakenElsewhere = (rank: number, optionValue: string) => {
    if (allowDuplicates) return false;
    return answers.some((a) => a.rank !== rank && a.optionValue === optionValue);
  };

  // 가로 레이아웃(columns=0) — 라벨·select 가 콘텐츠 기반 크기로 바로 붙음.
  // select 는 inline-style 고정 폭(데스크톱 200px, 모바일 full-width).
  // 세로 모드에선 라벨 고정폭으로 정렬.
  const isHorizontal = columns === 0 && !compact;
  // 가로(wrap) 또는 N열 그리드 일 때 기타 input 을 select-block 과 별도 sibling 으로 렌더.
  // → flex-wrap 에선 select 오른쪽에 나타나고, grid 에선 다음 셀을 차지해 자연 줄바꿈 유도.
  const isInlineOther = !compact && (columns === 0 || (columns != null && columns >= 2));
  const isGrid = !compact && columns != null && columns >= 2;
  // 스타일 프리셋 (compact: 테이블 셀 컨텍스트 / full: 질문 레벨)
  // 빌더 미리보기(question-preview.tsx)와 시각 통일 — rounded-md, border-gray-200, p-2, text-sm
  const rankLabelCls = compact
    ? 'w-10 shrink-0 text-xs font-medium text-gray-600'
    : isHorizontal
      ? 'shrink-0 text-sm font-medium text-gray-700'
      : 'w-12 shrink-0 text-sm font-medium text-gray-700';
  // truncate: 긴 옵션 라벨이 select 폭을 밀어내지 않고 "..." 으로 잘림.
  // 가로 모드에서는 w-full 제거 — 행 자체가 content-width 이므로 select 는 inline-style 로 고정.
  const selectCls = compact
    ? 'w-full appearance-none truncate rounded border border-gray-300 bg-white py-2 pr-2 pl-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none'
    : `${isHorizontal ? '' : 'w-full '}${RANKING_SELECT_BASE_CLS} ${RANKING_SELECT_FOCUS_CLS}`;
  // 기타 자유입력 Input — select 높이에 맞추기 위해 기본 h-12/rounded-lg/p-3/text-base 오버라이드.
  // compact 는 셀 내부용 별도 스타일.
  const otherInputBaseCls = compact
    ? 'h-8 text-xs'
    : 'h-auto rounded-md border-gray-200 px-2 py-2 text-sm';
  const otherWrapperCls = compact ? '' : isHorizontal ? '' : 'ml-[3.5rem]';
  const rowCls = compact ? 'space-y-1' : 'space-y-2';
  // 컨테이너 레이아웃은 columns prop 기반. compact 는 내부 select/label 크기만 영향.
  const layout = getOptionsLayout(columns);

  return (
    <div className={layout.className} style={layout.style}>
      {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => {
        const currentValue = selectedValueAt(rank);
        const showOtherInput = currentValue === RANKING_OTHER_VALUE;
        const selectedOpt = currentValue && currentValue !== RANKING_OTHER_VALUE
          ? options.find((o) => o.value === currentValue)
          : undefined;
        const showOptionTextInput = !showOtherInput && selectedOpt?.allowTextInput === true;

        const selectEl = (
          <select
            value={currentValue}
            onChange={(e) => handleSelect(rank, e.target.value)}
            className={selectCls}
            style={isHorizontal ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined}
          >
            <option value="">{compact ? '선택하세요' : '선택하세요...'}</option>
            {options.map((opt) => (
              <option
                key={opt.id}
                value={opt.value}
                disabled={isTakenElsewhere(rank, opt.value)}
              >
                {opt.label}
              </option>
            ))}
            {allowOther && <option value={RANKING_OTHER_VALUE}>기타 (직접 입력)</option>}
          </select>
        );

        // 가로/그리드: select-block 과 input-block 을 컨테이너 직계 sibling 으로 emit.
        if (isInlineOther) {
          return (
            <Fragment key={rank}>
              <div className="flex items-center gap-1.5">
                <span className={rankLabelCls}>{rank}순위</span>
                {selectEl}
              </div>
              {showOtherInput && (
                <div className={isGrid ? 'w-full' : undefined}>
                  <Input
                    placeholder="기타 내용 입력..."
                    value={otherTextAt(rank)}
                    onChange={(e) => handleOtherText(rank, e.target.value)}
                    className={`${otherInputBaseCls}${isGrid ? ' w-full' : ''}`}
                    style={isHorizontal ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined}
                  />
                </div>
              )}
              {showOptionTextInput && (
                <div className={isGrid ? 'w-full' : undefined}>
                  <Input
                    placeholder="상세 기재"
                    value={optionTextAt(rank)}
                    onChange={(e) => handleOptionText(rank, e.target.value)}
                    className={`${otherInputBaseCls}${isGrid ? ' w-full' : ''}`}
                    style={isHorizontal ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined}
                  />
                </div>
              )}
            </Fragment>
          );
        }

        // 세로 / compact: input 을 rank 블록 안에 중첩 (select 아래 indent).
        return (
          <div key={rank} className={rowCls}>
            <div className={`flex items-center ${compact ? 'gap-2' : 'gap-1.5'}`}>
              <span className={rankLabelCls}>{rank}순위</span>
              {selectEl}
            </div>
            {showOtherInput && (
              <div className={otherWrapperCls}>
                <Input
                  placeholder="기타 내용 입력..."
                  value={otherTextAt(rank)}
                  onChange={(e) => handleOtherText(rank, e.target.value)}
                  className={`${otherInputBaseCls}${compact ? '' : ' w-full'}`}
                />
              </div>
            )}
            {showOptionTextInput && (
              <div className={otherWrapperCls}>
                <Input
                  placeholder="상세 기재"
                  value={optionTextAt(rank)}
                  onChange={(e) => handleOptionText(rank, e.target.value)}
                  className={`${otherInputBaseCls}${compact ? '' : ' w-full'}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
