import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SurveyListPage from './page';

const useSurveys = vi.fn();

vi.mock('@/features/survey-builder/queries/use-surveys', () => ({
  useSurveys: () => useSurveys(),
  useDeleteSurvey: () => ({ mutate: vi.fn() }),
  useDuplicateSurvey: () => ({ mutate: vi.fn(), isPending: false }),
  useSetSurveyListTitle: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/actions/auth-actions', () => ({ logout: vi.fn() }));

const GROUP = '언론진흥재단 자체 만족도 조사';

function row(id: string, title: string, listGroup: string | null, updatedAt = '2026-11-10') {
  return {
    id,
    title,
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 0,
    completedResponseCount: 0,
    fieldworkCompletedCount: 0,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date(`${updatedAt}T03:00:00.000Z`),
    isPublic: false,
    listTitle: null,
    listGroup,
  };
}

const surveys = [
  row('k1', '부산지사 교육 수요자 만족도 조사', GROUP, '2026-11-08'),
  row('s1', '유가공업 실태조사', null),
  row('k2', '언론인금고 이용자 만족도 설문조사', GROUP, '2026-11-10'),
];

describe('설문 관리 목록 — 묶음 접어두기', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSurveys.mockReturnValue({ data: surveys, isLoading: false, error: null });
  });

  it('묶음이 없으면 구역 제목 없이 지금처럼 카드만 그린다', () => {
    useSurveys.mockReturnValue({
      data: [row('s1', '유가공업 실태조사', null)],
      isLoading: false,
      error: null,
    });
    render(<SurveyListPage />);

    expect(screen.getByText('유가공업 실태조사')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /묶음/ })).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('묶음에 든 설문은 접힌 묶음 카드 한 장으로 모이고 묶이지 않은 설문만 카드로 보인다', () => {
    render(<SurveyListPage />);

    const toggle = screen.getByRole('button', { name: new RegExp(GROUP) });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('설문 2');
    expect(toggle.textContent).toContain('최근 수정');
    expect(screen.queryByText('부산지사 교육 수요자 만족도 조사')).toBeNull();
    expect(screen.queryByText('언론인금고 이용자 만족도 설문조사')).toBeNull();
    expect(screen.getByText('유가공업 실태조사')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '묶음 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '설문 1' })).toBeTruthy();
  });

  it('묶음 카드를 누르면 그 자리에서 펼쳐지고 다시 누르면 접힌다', () => {
    render(<SurveyListPage />);
    const toggle = screen.getByRole('button', { name: new RegExp(GROUP) });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText('부산지사 교육 수요자 만족도 조사')).toBeTruthy();
    expect(within(panel!).getByText('언론인금고 이용자 만족도 설문조사')).toBeTruthy();
    expect(within(panel!).queryByText('유가공업 실태조사')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('부산지사 교육 수요자 만족도 조사')).toBeNull();
  });

  it('펼쳐 둔 묶음은 브라우저가 기억해 다시 열어도 펼쳐져 있다', () => {
    const first = render(<SurveyListPage />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(GROUP) }));
    first.unmount();

    render(<SurveyListPage />);
    expect(
      screen.getByRole('button', { name: new RegExp(GROUP) }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('부산지사 교육 수요자 만족도 조사')).toBeTruthy();
  });

  it('브라우저에 남은 펼침 기록이 깨져 있으면 접힌 상태로 그린다', () => {
    window.localStorage.setItem('survey-list-open-groups', '{깨진 값');
    render(<SurveyListPage />);

    expect(
      screen.getByRole('button', { name: new RegExp(GROUP) }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('검색하면 접힌 묶음 안의 설문도 바로 나오고 카드에 묶음 이름이 붙는다', () => {
    render(<SurveyListPage />);

    fireEvent.change(screen.getByPlaceholderText('설문 검색...'), { target: { value: '부산' } });

    expect(screen.getByText('부산지사 교육 수요자 만족도 조사')).toBeTruthy();
    expect(screen.getByText(GROUP)).toBeTruthy();
    expect(screen.getByRole('heading', { name: '검색 결과 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(GROUP) })).toBeNull();
    expect(screen.queryByText('유가공업 실태조사')).toBeNull();
  });
});
