'use client';

import {
  OPTION_TEXT_BARE_INPUT_CLS,
  OptionTextRow,
} from '@/features/question-renderer/option-text-input-stack';
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
import { getOptionsLayout } from '@/features/question-renderer/utils/options-layout';
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
  // 스타일 프리셋 (compact: 테이블 셀 컨텍스트 / full: 질문 레벨)
  // 셀 컨텍스트 select 는 표 본문과 같은 16px(text-base) — 테이블 셀 본문 고정 크기 규칙
  const rankLabelCls = compact
    ? 'w-10 shrink-0 text-xs font-medium text-gray-600'
    : isHorizontal
      ? 'shrink-0 text-sm font-medium text-gray-700'
      : 'w-12 shrink-0 text-sm font-medium text-gray-700';
  // truncate: 긴 옵션 라벨이 select 폭을 밀어내지 않고 "..." 으로 잘림.
  // 가로 모드에서는 w-full 제거 — 행 자체가 content-width 이므로 select 는 inline-style 로 고정.
  const selectCls = compact
    ? 'w-full appearance-none truncate rounded border border-gray-300 bg-white py-2 pr-2 pl-2 text-base focus:ring-2 focus:ring-blue-500 focus:outline-none'
    : `${isHorizontal ? '' : 'w-full '}${RANKING_SELECT_BASE_CLS} ${RANKING_SELECT_FOCUS_CLS}`;
  // 기타/상세 입력 — OptionTextRow(라벨 칩 + 맨몸 input) 셸 사용. compact 는 셀 내부용 축소.
  const bareInputCls = cn(OPTION_TEXT_BARE_INPUT_CLS, compact && 'h-6 text-xs');

  // 컨테이너 레이아웃은 columns prop 기반. compact 는 내부 select/label 크기만 영향.
  const layout = getOptionsLayout(columns);

  // 기타 입력란(1d): 상세/기타 입력을 순위 그리드 안(셀 옆·아래)이 아니라 그리드 전체의
  // 아래에 순위 순서대로 풀폭 스택으로 렌더한다. 그리드 배치·폭에는 영향 없음.
  const detailRowEls = Array.from({ length: positions }, (_, i) => i + 1)
    .map((rank) => {
      const currentValue = selectedValueAt(rank);
      if (!currentValue) return null;
      if (currentValue === RANKING_OTHER_VALUE) {
        return (
          <OptionTextRow key={`detail-${rank}`} label="기타" compact={compact}>
            <input
              type="text"
              placeholder="기타 내용 입력..."
              aria-label={`${rank}순위 기타 상세 기재`}
              name={`ranking-other-${rank}`}
              autoComplete="off"
              value={otherTextAt(rank)}
              onChange={(e) => handleOtherText(rank, e.target.value)}
              className={bareInputCls}
              data-option-text-target-id={
                detailTargetScopeId
                  ? rankingTextTargetId(detailTargetScopeId, rank, RANKING_OTHER_VALUE)
                  : undefined
              }
            />
          </OptionTextRow>
        );
      }
      const selectedOpt = options.find((o) => o.value === currentValue);
      if (!selectedOpt?.allowTextInput) return null;
      return (
        <OptionTextRow
          key={`detail-${rank}`}
          label={substituteTokens(selectedOpt.label, attrs, quotes).trim() || '상세 기재'}
          compact={compact}
        >
          <input
            type="text"
            placeholder={selectedOpt.textInputPlaceholder || '상세 기재'}
            aria-label={`${rank}순위 상세 기재`}
            name={`ranking-text-${rank}`}
            autoComplete="off"
            value={optionTextAt(rank)}
            onChange={(e) => handleOptionText(rank, e.target.value)}
            className={bareInputCls}
            data-option-text-target-id={
              detailTargetScopeId
                ? rankingTextTargetId(detailTargetScopeId, rank, currentValue)
                : undefined
            }
          />
        </OptionTextRow>
      );
    })
    .filter(Boolean);

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className={layout.className} style={layout.style}>
        {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => {
          const currentValue = selectedValueAt(rank);
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
          // 하이라이트는 링만. 옵션에 커스텀 배경색이 깔리면 인라인 스타일이 배경을 덮어
          // 어느 항목에 커서가 있는지 안 보인다(c7134ac4 회귀).
          'data-[highlighted]:ring-2 data-[highlighted]:ring-blue-100 data-[highlighted]:ring-inset',
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
                // 포커스 링은 옅은 하늘색. SelectTrigger 기본 --ring(#007aff)이 진해서 덮는다.
                'focus:border-blue-100 focus:ring-2 focus:ring-blue-100 focus:ring-offset-0',
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

        return (
          <div
            key={rank}
            className={cn(
              'flex items-center',
              compact ? 'gap-2' : 'gap-1.5',
              isMobile && 'w-full min-w-0',
            )}
          >
            <span className={rankLabelCls}>{rank}순위</span>
            {selectEl}
          </div>
        );
        })}
      </div>
      {detailRowEls.length > 0 && (
        <div className={compact ? 'space-y-1' : 'space-y-1.5'}>{detailRowEls}</div>
      )}
    </div>
  );
}
