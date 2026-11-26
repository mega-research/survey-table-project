import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, TableCell } from '@/types/survey';

import { ChoiceOptCell } from './choice-opt-cell';

vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

/**
 * 보기 칸의 컨트롤 높이 — 글자 없는 보기 칸(「해당없음」처럼 이름을 머리에만 둔 칸)의 컨트롤이 글자 있는
 * 이웃 칸의 컨트롤과 같은 높이에 선다.
 *
 * 컨트롤은 라벨 첫 줄에 맞추려고 위 여백을 갖는다. 글자가 없으면 그 줄(26px)이 없어 줄 상자가 20px 로 줄고,
 * 칸의 세로 정렬이 가운데·아래일 때 컨트롤이 이웃보다 3 ~ 6px 낮게 선다. 글자 없는 칸도 한 줄 높이를 갖게 해
 * 줄 상자를 같게 만든다. jsdom 은 배치를 하지 않으므로 그 높이를 주는 클래스로 확인한다.
 */

const group: ChoiceGroup = { id: 'g', type: 'radio', groupKey: 'rad1', label: '' };
const cell = (extra: Partial<TableCell>): TableCell => ({
  id: 'c1',
  type: 'choice_opt',
  content: '',
  choiceLabel: '해당없음',
  choiceGroupId: 'g',
  ...extra,
});
/** 컨트롤과 라벨이 놓이는 줄 */
const controlRow = () => screen.getByRole('radio').parentElement!;
const ONE_LINE = 'min-h-[1.625rem]';

describe('ChoiceOptCell — 글자 없는 보기 칸의 컨트롤 높이', () => {
  it('글자 없는 칸은 한 줄 높이를 갖는다 — 글자 있는 칸과 줄 상자가 같아진다', () => {
    render(<ChoiceOptCell cell={cell({ content: '' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).toContain(ONE_LINE);
  });

  it('공백뿐인 칸도 글자 없는 칸이다', () => {
    render(<ChoiceOptCell cell={cell({ content: '   ' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).toContain(ONE_LINE);
  });

  it('글자 있는 칸은 지금 그대로다 — 라벨의 줄 높이가 줄 상자를 정한다', () => {
    render(<ChoiceOptCell cell={cell({ content: '⑩' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).not.toContain(ONE_LINE);
    expect(screen.getByText('⑩')).toBeInTheDocument();
  });

  it('세로 타일(모바일 그룹 카드)은 건드리지 않는다', () => {
    render(
      <ChoiceOptCell
        cell={cell({ content: '' })}
        questionId="q1"
        group={group}
        value={{}}
        variant="tile"
      />,
    );
    expect(document.querySelector(`.${CSS.escape(ONE_LINE)}`)).toBeNull();
  });
});
