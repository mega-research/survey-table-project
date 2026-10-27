'use client';

import { useCallback, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import {
  belowTableOptionTextsFromKey,
  belowTableSelectionKey,
  collectBelowTableCandidates,
} from '@/features/question-renderer/utils/option-text-below-table';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';
import { systemText } from '@/utils/system-strings';

import { OptionTextInput } from './option-text-input';
import { useInlineSurveyLocale } from './survey-locale-context';

interface OptionTextBelowTableProps {
  questionId: string;
  /** 화면에 그려지는 열·행(표시 조건을 거친 뒤) — 셀 인덱스가 서로 맞아야 한다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  displayRows: TableRow[];
  /** 응답 원본이 주입되지 않은 렌더(controlled)의 표 응답 */
  value?: Record<string, unknown> | undefined;
}

/**
 * 표 아래 상세 기재 줄 — 「상세 기재 입력칸을 표 아래에」를 켠 칸의 선택된 「기타」 보기마다
 * `행 제목 · 열 제목 | 입력칸` 한 줄. 가로 스크롤 컨테이너 밖에 두어 표를 밀어도 따라가지 않는다.
 *
 * 표 응답은 여기서 따로 구독한다 — 표 컴포넌트는 칸 값이 바뀔 때마다 다시 그려지지 않는다
 * (칸 단위 구독). 선택된 (칸, 보기) 쌍을 글자 하나로 접어 구독하므로 다른 칸의 입력에는 조용하다.
 */
export function OptionTextBelowTable({
  questionId,
  columns,
  headerGrid,
  displayRows,
  value,
}: OptionTextBelowTableProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const locale = useInlineSurveyLocale();
  const { questionResponses: source } = useResponseSources();
  const candidates = useMemo(
    () => collectBelowTableCandidates({ columns, headerGrid, displayRows }),
    [columns, headerGrid, displayRows],
  );
  const selectKey = useCallback(
    (questionResponse: unknown) => belowTableSelectionKey(candidates, questionResponse),
    [candidates],
  );
  const sourceKey = useQuestionResponseSelector(source, questionId, selectKey);
  const selectionKey = source ? sourceKey : belowTableSelectionKey(candidates, value);
  const entries = useMemo(
    () => belowTableOptionTextsFromKey(candidates, selectionKey),
    [candidates, selectionKey],
  );

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5" data-testid="option-text-below-table">
      {entries.map(({ cell, option, labelParts }) => {
        const label =
          labelParts
            .map((part) => substituteTokens(part, attrs, quotes).trim())
            .filter(Boolean)
            .join(' · ') || systemText('input.optionTextPlaceholder', locale);
        return (
          <OptionTextInput
            key={`${cell.id}:${option.id}`}
            questionId={questionId}
            option={option}
            ariaLabel={label}
            rowLabel={label}
          />
        );
      })}
    </div>
  );
}
