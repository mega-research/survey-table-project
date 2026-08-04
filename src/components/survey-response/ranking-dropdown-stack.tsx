'use client';

import { Fragment } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMobileView } from '@/hooks/use-media-query';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { rankingTextTargetId } from '@/lib/survey/option-text-target';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
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
  columns?: number | undefined;
  /** 순수 상세기입 검증과 DOM 이동 타깃을 맞추는 질문/그룹/셀 scope ID */
  detailTargetScopeId?: string | undefined;
  inputIdScope?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
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
  detailTargetScopeId,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
}: RankingDropdownStackProps) {
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

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
        const selectedStyle = selectedOpt?.backgroundColor || selectedOpt?.textColor
          ? {
              ...(selectedOpt.backgroundColor
                ? { backgroundColor: selectedOpt.backgroundColor }
                : {}),
              ...(selectedOpt.textColor ? { color: selectedOpt.textColor } : {}),
            }
          : undefined;
        const selectedBold = selectedOpt?.textBold ? 'font-bold' : undefined;
        const triggerWidthStyle =
          isHorizontal && !isMobile ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined;
        const showOptionTextInput = !showOtherInput && selectedOpt?.allowTextInput === true;

        // compact(셀 컨텍스트)는 네이티브 select 유지. full(질문 레벨)은 Radix Select 로
        // 교체해 모바일에서 트리거를 키우고, 열린 목록에 max-height + 스크롤을 적용한다.
        const nativeSelectEl = (
          <select
            id={inputIdScope ? `${inputIdScope}-${rank}` : undefined}
            value={currentValue}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
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
                className={opt.textBold ? 'font-bold' : undefined}
                style={{
                  ...(opt.backgroundColor ? { backgroundColor: opt.backgroundColor } : {}),
                  ...(opt.textColor ? { color: opt.textColor } : {}),
                }}
              >
                {substituteTokens(opt.label, attrs, quotes)}
              </option>
            ))}
            {allowOther && <option value={RANKING_OTHER_VALUE}>기타 (직접 입력)</option>}
          </select>
        );

        // 옵션은 트리거 고정 너비 안에서 줄바꿈(긴 라벨이 화면 밖으로 넘치지 않게).
        const itemCls = cn(
          'whitespace-normal [overflow-wrap:anywhere]',
          // 체크 표시 자리(pl-8, 32px)를 없앤다. 순위형은 선택값이 트리거에도 보여 체크가
          // 없어도 무엇을 골랐는지 알 수 있고, 긴 라벨이 여러 줄로 접힐 때 들여쓰기가 크다.
          'pl-3 [&>span:first-child]:hidden',
          // 하이라이트는 연한 하늘색 배경으로. 다만 옵션에 커스텀 배경색이 깔리면 인라인
          // 스타일이 이겨 배경이 묻히므로(c7134ac4 회귀), 링을 함께 둬 항상 보이게 한다.
          'data-[highlighted]:bg-sky-100',
          'data-[highlighted]:ring-2 data-[highlighted]:ring-sky-400 data-[highlighted]:ring-inset',
          isMobile && 'py-3 text-base',
        );
        const radixSelectEl = (
          <Select
            value={currentValue}
            onValueChange={(v) => handleSelect(rank, v)}
          >
            <SelectTrigger
              id={inputIdScope ? `${inputIdScope}-${rank}` : undefined}
              aria-label={`${rank}순위 선택`}
              aria-invalid={ariaInvalid || undefined}
              aria-describedby={ariaDescribedBy}
              className={cn(
                // 모바일은 행 가득(균일 고정). 데스크톱 가로 레이아웃은 고정 px(아래 style).
                isHorizontal && !isMobile ? '' : 'w-full',
                'min-w-0',
                // 모바일 트리거 크게(iOS 확대 방지 위해 16px 이상), 높이는 h-12.
                isMobile ? 'h-12 text-base' : 'h-11 text-sm',
                selectedBold,
              )}
              style={{ ...triggerWidthStyle, ...selectedStyle }}
            >
              <SelectValue placeholder="선택하세요..." />
            </SelectTrigger>
            {/* Radix SelectContent 는 max-h(가용 높이) + overflow-y-auto + 스크롤 버튼 내장.
                높이는 320px(max-h-80)로 캡해 컴팩트하게, 너비는 트리거 너비에 고정해
                옵션이 화면 밖으로 넘치지 않게 한다. */}
            <SelectContent className="max-h-80 w-[var(--radix-select-trigger-width)]">
              {options.map((opt) => (
                <SelectItem
                  key={opt.id}
                  value={opt.value}
                  disabled={isTakenElsewhere(rank, opt.value)}
                  className={cn(itemCls, opt.textBold && 'font-bold')}
                  style={{
                    ...(opt.backgroundColor ? { backgroundColor: opt.backgroundColor } : {}),
                    ...(opt.textColor ? { color: opt.textColor } : {}),
                  }}
                >
                  {substituteTokens(opt.label, attrs, quotes)}
                </SelectItem>
              ))}
              {allowOther && (
                <SelectItem value={RANKING_OTHER_VALUE} className={itemCls}>
                  기타 (직접 입력)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        );

        const selectEl = compact ? nativeSelectEl : radixSelectEl;

        // 가로/그리드: select-block 과 input-block 을 컨테이너 직계 sibling 으로 emit.
        if (isInlineOther) {
          return (
            <Fragment key={rank}>
              <div className={cn('flex items-center gap-1.5', isMobile && 'w-full min-w-0')}>
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
                    data-option-text-target-id={
                      detailTargetScopeId
                        ? rankingTextTargetId(detailTargetScopeId, rank, RANKING_OTHER_VALUE)
                        : undefined
                    }
                  />
                </div>
              )}
              {showOptionTextInput && (
                <div className={isGrid ? 'w-full' : undefined}>
                  <Input
                    placeholder={selectedOpt?.textInputPlaceholder || '상세 기재'}
                    value={optionTextAt(rank)}
                    onChange={(e) => handleOptionText(rank, e.target.value)}
                    className={`${otherInputBaseCls}${isGrid ? ' w-full' : ''}`}
                    style={isHorizontal ? { width: RANKING_HORIZONTAL_ITEM_WIDTH } : undefined}
                    data-option-text-target-id={
                      detailTargetScopeId
                        ? rankingTextTargetId(detailTargetScopeId, rank, currentValue)
                        : undefined
                    }
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
                  data-option-text-target-id={
                    detailTargetScopeId
                      ? rankingTextTargetId(detailTargetScopeId, rank, RANKING_OTHER_VALUE)
                      : undefined
                  }
                />
              </div>
            )}
            {showOptionTextInput && (
              <div className={otherWrapperCls}>
                <Input
                  placeholder={selectedOpt?.textInputPlaceholder || '상세 기재'}
                  value={optionTextAt(rank)}
                  onChange={(e) => handleOptionText(rank, e.target.value)}
                  className={`${otherInputBaseCls}${compact ? '' : ' w-full'}`}
                  data-option-text-target-id={
                    detailTargetScopeId
                      ? rankingTextTargetId(detailTargetScopeId, rank, currentValue)
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
