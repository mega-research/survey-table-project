/**
 * 순위형 "보기 클릭" — 다국어 설문의 현재 언어로 요약 줄·초기화·기타 입력 줄을 그린다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SurveyLocaleProvider } from '@/features/question-renderer/survey-locale-context';
import type { QuestionOption, RankingAnswer } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';
import { RANKING_OTHER_VALUE } from '@/utils/ranking-shared';

import { RankingDropdownStack } from './cells/ranking-dropdown-stack';
import { RankingClickList } from './ranking-click-select';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

const options: QuestionOption[] = [
  { id: 'a', value: 'a', label: 'A' },
  { id: 'b', value: 'b', label: 'B' },
];

function renderList(locale: SurveyLocale, answers: RankingAnswer[]) {
  render(
    <SurveyLocaleProvider locale={locale}>
      <RankingClickList
        answers={answers}
        options={options}
        positions={2}
        allowOther
        onChange={vi.fn()}
        questionId="q1"
      />
    </SurveyLocaleProvider>,
  );
}

describe('RankingClickList 현재 언어', () => {
  it('中文 — 순위 이름·초기화·기타 보기가 중국어다', () => {
    renderList('zh', [{ rank: 1, optionValue: RANKING_OTHER_VALUE }]);
    expect(screen.getByText('第2位')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置排名' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /其他（请注明）/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '第1位 其他 详细说明' })).toHaveAttribute(
      'placeholder',
      '请输入其他内容...',
    );
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });

  it('English — 순위가 다 찬 안내가 영어다', () => {
    renderList('en', [
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Other \(please specify\)/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'You have ranked all 2 positions. To change, click a selected option again or reset the ranking.',
    );
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });
});

describe('RankingDropdownStack 현재 언어', () => {
  it('中文 — 표 안 순위 드롭다운의 순위·선택 안내·기타 입력 줄이 중국어다', () => {
    render(
      <SurveyLocaleProvider locale="zh">
        <RankingDropdownStack
          answers={[{ rank: 1, optionValue: RANKING_OTHER_VALUE }]}
          options={options}
          positions={2}
          allowDuplicates={false}
          allowOther
          onChange={vi.fn()}
          compact
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('第1位')).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: '请选择' })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: '其他（请注明）' })).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: '第1位 其他 详细说明' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });
});
