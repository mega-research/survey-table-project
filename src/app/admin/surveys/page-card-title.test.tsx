import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SurveyListPage from './page';

const useSurveys = vi.fn();
const setListTitle = vi.fn();
let isSaving = false;

vi.mock('@/features/survey-builder/queries/use-surveys', () => ({
  useSurveys: () => useSurveys(),
  useDeleteSurvey: () => ({ mutate: vi.fn() }),
  useDuplicateSurvey: () => ({ mutate: vi.fn(), isPending: false }),
  useSetSurveyListTitle: () => ({ mutate: setListTitle, isPending: isSaving }),
}));
vi.mock('@/actions/auth-actions', () => ({ logout: vi.fn() }));

const GROUP = '언론진흥재단 자체 만족도 조사';

function row(
  id: string,
  title: string,
  listTitle: string | null,
  listGroup: string | null = null,
) {
  return {
    id,
    title,
    listTitle,
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 0,
    completedResponseCount: 0,
    fieldworkCompletedCount: 0,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-10T03:00:00.000Z'),
    isPublic: false,
    listGroup,
  };
}

const PLAIN = row('s1', '유가공업 실태조사', null);
const NAMED = row('s2', '지역신문발전기금 우선지원대상사 만족도 조사', '3. 지역언론팀 — 우선지원대상사');

function mockList(data: ReturnType<typeof row>[]) {
  useSurveys.mockReturnValue({ data, isLoading: false, error: null });
}

/** 카드의 「⋮」 메뉴에서 「카드 제목 바꾸기」를 눌러 창을 연다. */
function openCardTitleDialog(cardTitle: string) {
  const card = screen.getByRole('heading', { name: cardTitle }).closest('.group') as HTMLElement;
  // 「⋮」 버튼은 글자가 없다 — 이름 없는 버튼 가운데 첫째가 메뉴 버튼이다.
  const menuButton = within(card)
    .getAllByRole('button')
    .find((button) => button.textContent === '') as HTMLElement;
  fireEvent.click(menuButton);
  fireEvent.click(within(card).getByRole('button', { name: '카드 제목 바꾸기' }));
  return screen.getByRole('dialog', { name: '카드 제목 바꾸기' });
}

describe('설문 관리 목록 — 카드 제목', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setListTitle.mockReset();
    isSaving = false;
    mockList([PLAIN, NAMED]);
  });
  afterEach(cleanup);

  it('카드 제목이 없는 설문은 설문 제목을 그대로 보이고 설문 제목 줄을 따로 두지 않는다', () => {
    render(<SurveyListPage />);

    expect(screen.getByRole('heading', { name: '유가공업 실태조사' })).toBeTruthy();
    expect(screen.queryByText('설문 제목: 유가공업 실태조사')).toBeNull();
  });

  it('카드 제목을 지은 설문은 카드 제목을 머리에 보이고 설문 제목을 한 줄 더 보인다', () => {
    render(<SurveyListPage />);

    expect(screen.getByRole('heading', { name: '3. 지역언론팀 — 우선지원대상사' })).toBeTruthy();
    expect(screen.getByText('설문 제목: 지역신문발전기금 우선지원대상사 만족도 조사')).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: '지역신문발전기금 우선지원대상사 만족도 조사' }),
    ).toBeNull();
  });

  it('카드 제목으로도 설문 제목으로도 찾는다', () => {
    render(<SurveyListPage />);
    const search = screen.getByPlaceholderText('설문 검색...');

    fireEvent.change(search, { target: { value: '지역언론팀' } });
    expect(screen.getByRole('heading', { name: '3. 지역언론팀 — 우선지원대상사' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '유가공업 실태조사' })).toBeNull();

    fireEvent.change(search, { target: { value: '지역신문발전기금' } });
    expect(screen.getByRole('heading', { name: '3. 지역언론팀 — 우선지원대상사' })).toBeTruthy();

    fireEvent.change(search, { target: { value: '유가공' } });
    expect(screen.getByRole('heading', { name: '유가공업 실태조사' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '3. 지역언론팀 — 우선지원대상사' })).toBeNull();
  });

  it('묶음 안의 카드는 카드 제목순으로 선다 — 2 가 10 앞에 온다', () => {
    mockList([
      row('k10', '2026년 광고주 대상 정부광고 교육 만족도 조사', '10. 광고기획팀 — 교육', GROUP),
      row('k2', '언론인금고 이용자 만족도 설문조사', '2. 미디어지원팀 — 언론인금고', GROUP),
      row('k1', '한국언론진흥재단 이용자 만족도 설문조사 (계약체결)', '1-1. 경영지원팀 — 계약체결', GROUP),
    ]);
    render(<SurveyListPage />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(GROUP) }));

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      '1-1. 경영지원팀 — 계약체결',
      '2. 미디어지원팀 — 언론인금고',
      '10. 광고기획팀 — 교육',
    ]);
  });

  it('「카드 제목 바꾸기」 창은 지금 카드 제목을 칸에, 설문 제목을 따로 보인다', () => {
    render(<SurveyListPage />);

    const dialog = openCardTitleDialog('3. 지역언론팀 — 우선지원대상사');

    const input = within(dialog).getByLabelText('카드 제목') as HTMLInputElement;
    expect(input.value).toBe('3. 지역언론팀 — 우선지원대상사');
    expect(within(dialog).getByText('지역신문발전기금 우선지원대상사 만족도 조사')).toBeTruthy();
    expect(within(dialog).getByText(/응답자가 보는 설문 제목은 바뀌지 않습니다/)).toBeTruthy();
  });

  it('카드 제목이 없는 설문은 빈 칸으로 열리고, 적어 저장하면 정돈한 값으로 요청한다', () => {
    render(<SurveyListPage />);
    const dialog = openCardTitleDialog('유가공업 실태조사');
    const input = within(dialog).getByLabelText('카드 제목') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('유가공업 실태조사');

    fireEvent.change(input, { target: { value: '  유가공업  (낙농진흥회) ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(setListTitle).toHaveBeenCalledTimes(1);
    expect(setListTitle.mock.calls[0]?.[0]).toEqual({
      surveyId: 's1',
      listTitle: '유가공업 (낙농진흥회)',
    });
  });

  it('칸을 비워 저장하면 지우는 요청(null)이 간다 — 설문 제목을 따라가게', () => {
    render(<SurveyListPage />);
    const dialog = openCardTitleDialog('3. 지역언론팀 — 우선지원대상사');

    fireEvent.change(within(dialog).getByLabelText('카드 제목'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(setListTitle.mock.calls[0]?.[0]).toEqual({ surveyId: 's2', listTitle: null });
  });

  it('바뀐 것이 없으면 저장 버튼이 꺼져 있다 — 설문 제목과 같은 글자를 적어도 마찬가지다', () => {
    render(<SurveyListPage />);
    const dialog = openCardTitleDialog('유가공업 실태조사');
    const save = within(dialog).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('카드 제목'), {
      target: { value: '유가공업 실태조사' },
    });
    expect(save.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('카드 제목'), { target: { value: '이름표' } });
    expect(save.disabled).toBe(false);
  });

  it('저장 요청이 가는 동안에는 칸과 버튼이 잠긴다', () => {
    isSaving = true;
    render(<SurveyListPage />);
    const dialog = openCardTitleDialog('3. 지역언론팀 — 우선지원대상사');

    expect((within(dialog).getByLabelText('카드 제목') as HTMLInputElement).disabled).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: '저장 중...' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((within(dialog).getByRole('button', { name: '취소' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
