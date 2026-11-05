import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import type { NumericIssue } from '@/features/survey-response/lib/numeric-validation';
import type { Question } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

import { resolveCollapsedQuestionOpen } from './group-step-item';

/**
 * 문항 접어 두기(`collapseButtonLabel`, 2026-11-05 유가공업 「[붙임] 제품 품목 코드표」) — 글자가 있으면 그 버튼만
 * 보이고 누르면 문항이 펼쳐진다. 검증 문제가 있으면 접힌 채로 두지 않는다.
 */
vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

function renderItem(partial: Partial<Question>, opts: { showRequiredMessage?: boolean; issues?: NumericIssue[] } = {}) {
  const question = { id: 'q1', type: 'text', title: '[붙임] 코드표', required: false, order: 1, ...partial } as Question;
  const item: StepItem = { question, rootGroupId: null, rootGroupName: null, subgroupName: null };
  return render(
    <GroupStepItem
      item={item}
      showSubgroupHeading={false}
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted={false}
      showRequiredMessage={opts.showRequiredMessage ?? false}
      showChangeConfirmMessage={false}
      issues={opts.issues}
    />,
  );
}

describe('문항 접어 두기', () => {
  it('글자가 없으면 버튼 없이 기존 화면 그대로다', () => {
    renderItem({});
    expect(screen.getByText('[붙임] 코드표')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /코드표/ })).toBeNull();
  });

  it('공백뿐인 글자는 꺼진 것으로 본다', () => {
    renderItem({ collapseButtonLabel: '   ' });
    expect(screen.getByText('[붙임] 코드표')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('글자가 있으면 버튼만 보이고, 누르면 펼치고 다시 누르면 접는다', () => {
    renderItem({ collapseButtonLabel: '제품 품목 코드표' });
    const button = screen.getByRole('button', { name: '제품 품목 코드표' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('[붙임] 코드표')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('[붙임] 코드표')).toBeTruthy();
    const controls = button.getAttribute('aria-controls');
    expect(controls && document.getElementById(controls)).toBeTruthy();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('[붙임] 코드표')).toBeNull();
  });

  it('필수 강조가 뜨면 누르지 않아도 펼쳐져 있다', () => {
    renderItem({ collapseButtonLabel: '코드표 보기', required: true }, { showRequiredMessage: true });
    expect(screen.getByRole('button', { name: '코드표 보기' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('[붙임] 코드표')).toBeTruthy();
  });
});

describe('resolveCollapsedQuestionOpen', () => {
  it('접기를 안 켰으면 늘 펼침', () => {
    expect(resolveCollapsedQuestionOpen({ label: '', userOpen: false, hasProblem: false })).toBe(true);
  });
  it('켰으면 응답자가 연 상태 또는 검증 문제가 있을 때 펼침', () => {
    expect(resolveCollapsedQuestionOpen({ label: '보기', userOpen: false, hasProblem: false })).toBe(false);
    expect(resolveCollapsedQuestionOpen({ label: '보기', userOpen: true, hasProblem: false })).toBe(true);
    expect(resolveCollapsedQuestionOpen({ label: '보기', userOpen: false, hasProblem: true })).toBe(true);
  });
});
