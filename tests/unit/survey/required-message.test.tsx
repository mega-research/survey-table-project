import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import type { StepItem } from '@/lib/group-ordering';
import type { Question } from '@/types/survey';
import {
  DEFAULT_REQUIRED_MESSAGE,
  resolveRequiredMessage,
} from '@/utils/required-message';

vi.mock('@/utils/branch-logic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/branch-logic')>()),
  shouldDisplayQuestion: () => true,
}));
// 보기 그룹 표는 useMobileView(matchMedia)를 쓴다 — jsdom 에 없으니 데스크톱으로 고정
vi.mock('@/hooks/use-media-query', () => ({ useMobileView: () => false, useMediaQuery: () => false }));

function textQuestion(partial: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '이름을 입력해 주세요',
    required: true,
    order: 1,
    ...partial,
  } as Question;
}

const toItem = (question: Question): StepItem => ({
  question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});

function renderItem(question: Question, showRequiredMessage: boolean) {
  return render(
    <GroupStepItem
      item={toItem(question)}
      showSubgroupHeading={false}
      responses={{}}
      questions={[question]}
      onResponse={vi.fn()}
      isHighlighted={showRequiredMessage}
      showRequiredMessage={showRequiredMessage}
      showChangeConfirmMessage={false}
    />,
  );
}

describe('resolveRequiredMessage', () => {
  it('사용자 지정 문구가 있으면 그대로 반환한다', () => {
    expect(resolveRequiredMessage({ requiredMessage: '연락처는 꼭 남겨주세요' })).toBe(
      '연락처는 꼭 남겨주세요',
    );
  });

  it('미입력·공백뿐이면 기본 문구로 폴백한다', () => {
    expect(resolveRequiredMessage({ requiredMessage: null })).toBe(DEFAULT_REQUIRED_MESSAGE);
    expect(resolveRequiredMessage({})).toBe(DEFAULT_REQUIRED_MESSAGE);
    expect(resolveRequiredMessage({ requiredMessage: '   ' })).toBe(DEFAULT_REQUIRED_MESSAGE);
  });
});

describe('GroupStepItem 필수 안내 문구', () => {
  it('showRequiredMessage=true 이고 지정 문구가 있으면 그 문구를 표시한다', () => {
    renderItem(textQuestion({ requiredMessage: '연락처는 꼭 남겨주세요' }), true);
    expect(screen.getByText('연락처는 꼭 남겨주세요')).toBeInTheDocument();
  });

  it('지정 문구가 없으면 기본 문구를 표시한다', () => {
    renderItem(textQuestion(), true);
    expect(screen.getByText(DEFAULT_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it('필수 안내 한 줄은 그 문항의 검증 안내 표식을 단다 — 「다음」이 막힌 뒤 스크롤 착지 지점', () => {
    renderItem(textQuestion(), true);
    expect(screen.getByText(DEFAULT_REQUIRED_MESSAGE)).toHaveAttribute('data-validation-notice', 'q1');
  });

  it('showRequiredMessage=false 이면 문구를 렌더하지 않는다', () => {
    renderItem(textQuestion({ requiredMessage: '연락처는 꼭 남겨주세요' }), false);
    expect(screen.queryByText('연락처는 꼭 남겨주세요')).not.toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_REQUIRED_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('GroupStepItem 보기 그룹 표의 필수 안내 — 배너와 「위치로 이동」', () => {
  /** Q9 축소판: 항목마다 기대 수준(rad1)·만족도(rad2) 라디오 그룹 */
  function groupedRadioQuestion(): Question {
    return {
      id: 'q9',
      type: 'radio',
      title: '기대 정도 및 만족도',
      required: true,
      order: 1,
      choiceGroups: [
        { id: 'g1', type: 'radio', groupKey: 'rad1', label: '기대 수준' },
        { id: 'g2', type: 'radio', groupKey: 'rad2', label: '만족도', requiredMessage: '만족도를 골라 주세요' },
      ],
      tableColumns: [
        { id: 'c0', label: '항목' },
        { id: 'c1', label: '낮음' },
        { id: 'c2', label: '높음' },
        { id: 'c3', label: '불만' },
        { id: 'c4', label: '만족' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'r1c0', type: 'text', content: '1) 정확성' },
            { id: 'r1c1', type: 'choice_opt', content: '1', choiceGroupId: 'g1' },
            { id: 'r1c2', type: 'choice_opt', content: '2', choiceGroupId: 'g1' },
            { id: 'r1c3', type: 'choice_opt', content: '1', choiceGroupId: 'g2' },
            { id: 'r1c4', type: 'choice_opt', content: '2', choiceGroupId: 'g2' },
          ],
        },
      ],
    } as unknown as Question;
  }

  function renderGrouped(responses: Record<string, unknown>, showRequiredMessage: boolean) {
    const question = groupedRadioQuestion();
    return render(
      <GroupStepItem
        item={toItem(question)}
        showSubgroupHeading={false}
        responses={responses}
        questions={[question]}
        onResponse={vi.fn()}
        isHighlighted={showRequiredMessage}
        showRequiredMessage={showRequiredMessage}
        showChangeConfirmMessage={false}
      />,
    );
  }

  it('「다음」이 막히면 미충족 그룹의 문구가 배너에 「위치로 이동」과 함께 뜨고 한 줄 안내는 사라진다', () => {
    renderGrouped({ q9: { rad1: 'r1c1' } }, true);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('data-validation-notice', 'q9');
    expect(banner).toHaveTextContent('만족도를 골라 주세요');
    expect(screen.getByRole('button', { name: '위치로 이동' })).toBeInTheDocument();
    expect(screen.getAllByText('만족도를 골라 주세요')).toHaveLength(1);
    expect(screen.queryByText(DEFAULT_REQUIRED_MESSAGE)).not.toBeInTheDocument();
  });

  it('그룹 지정 문구가 없는 그룹은 문항 기본 문구 한 줄로 묶인다', () => {
    renderGrouped({}, true);
    const buttons = screen.getAllByRole('button', { name: '위치로 이동' });
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent(DEFAULT_REQUIRED_MESSAGE);
    expect(screen.getByRole('alert')).toHaveTextContent('만족도를 골라 주세요');
  });

  it('「다음」을 누르기 전에는 배너가 없다', () => {
    renderGrouped({}, false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
