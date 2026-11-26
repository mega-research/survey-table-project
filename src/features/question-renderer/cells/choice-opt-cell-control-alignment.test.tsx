import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * 이웃 칸의 컨트롤과 같은 높이에 선다. **좁은 칸 모드의 조각(조각 한 화면 칸 수) 안에서만.**
 *
 * 컨트롤은 라벨 첫 줄에 맞추려고 위 여백을 갖는다. 글자가 없으면 그 줄(26px)이 없어 줄 상자가 20px 로 줄고,
 * 칸의 세로 정렬이 가운데·아래일 때 컨트롤이 이웃보다 3 ~ 6px 낮게 선다. 글자 없는 칸에 표식을 달고,
 * 전역 스타일이 좁은 칸 모드의 본문 표식(data-narrow-cells) 안에서만 한 줄 높이를 준다. PC 표와 한 화면 칸
 * 수를 켜지 않은 문항은 컨트롤 자리·행 높이가 그대로여야 하므로, 칸 자체에는 높이 클래스를 두지 않는다.
 * jsdom 은 배치를 하지 않으므로 표식과 규칙의 범위로 확인한다.
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
const BARE = 'choice-opt-bare-control';

describe('ChoiceOptCell — 글자 없는 보기 칸의 컨트롤 높이', () => {
  it('글자 없는 칸의 컨트롤 줄에 표식이 붙는다', () => {
    render(<ChoiceOptCell cell={cell({ content: '' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).toContain(BARE);
  });

  it('공백뿐인 칸도 글자 없는 칸이다', () => {
    render(<ChoiceOptCell cell={cell({ content: '   ' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).toContain(BARE);
  });

  it('글자 있는 칸에는 표식이 없다 — 라벨의 줄 높이가 줄 상자를 정한다', () => {
    render(<ChoiceOptCell cell={cell({ content: '⑩' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).not.toContain(BARE);
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
    expect(document.querySelector(`.${BARE}`)).toBeNull();
  });
});

describe('글자 없는 보기 칸의 높이 보정은 좁은 칸 모드의 조각 안에서만 걸린다', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

  it('칸 자체에는 높이 클래스가 없다 — PC 표와 끈 문항의 컨트롤 자리·행 높이가 그대로다', () => {
    render(<ChoiceOptCell cell={cell({ content: '' })} questionId="q1" group={group} value={{}} />);
    expect(controlRow().className).not.toMatch(/min-h-/);
  });

  it('전역 스타일의 규칙은 본문 표식 아래로만 적혀 있다', () => {
    const rules = [...css.matchAll(/([^{}]*)\.choice-opt-bare-control\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    expect(rules[0]![1]!.trim().endsWith('[data-narrow-cells]')).toBe(true);
    expect(rules[0]![2]).toMatch(/min-height:\s*1\.625rem/);
  });
});
