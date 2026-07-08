import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PreviewCell } from '@/components/survey-builder/cells/preview-cell';
import { TablePreview } from '@/components/survey-builder/table-preview';
import { getGroupTypeOfCell } from '@/utils/choice-group-helpers';
import type { Question, TableCell } from '@/types/survey';

const choiceCell: TableCell = {
  id: 'cell-1',
  type: 'choice_opt',
  content: '매우 나쁨',
  choiceLabel: '매우 나쁨',
};

describe('PreviewCell 보기 옵션 컨트롤 종류', () => {
  afterEach(cleanup);

  it('choiceControlType=radio 면 라디오로 렌더한다', () => {
    render(<PreviewCell cell={choiceCell} choiceControlType="radio" />);
    expect(screen.getByRole('radio')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('매우 나쁨')).toBeTruthy();
  });

  it('choiceControlType=checkbox 면 체크박스로 렌더한다', () => {
    render(<PreviewCell cell={choiceCell} choiceControlType="checkbox" />);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('미지정 시 checkbox 로 폴백한다', () => {
    render(<PreviewCell cell={choiceCell} />);
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });
});

// 그룹 혼합: radio 질문이지만 일부 셀이 checkbox 그룹에 속하면 셀별로 다르게 렌더되어야 한다.
describe('TablePreview 셀별 choiceControlType 리졸버 (그룹 혼합)', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(cleanup);

  function mixedGroupedQuestion(): Question {
    return {
      id: 'q1',
      type: 'radio', // 질문 기본 타입은 radio
      title: 'Q',
      required: false,
      order: 0,
      choiceGroups: [{ id: 'g-cb', groupKey: 'cb1', type: 'checkbox', label: '복수' }],
      tableColumns: [
        { id: 'c1', label: '①' },
        { id: 'c2', label: '②' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            // 비그룹 → 질문 타입(radio)
            { id: 'cellRadio', type: 'choice_opt', content: '단일', choiceLabel: '단일' },
            // checkbox 그룹 소속 → checkbox
            {
              id: 'cellCheck',
              type: 'choice_opt',
              content: '복수',
              choiceLabel: '복수',
              choiceGroupId: 'g-cb',
            },
          ],
        },
      ],
    } as unknown as Question;
  }

  it('비그룹 셀은 radio, checkbox 그룹 셀은 checkbox 로 렌더한다', () => {
    const q = mixedGroupedQuestion();
    const { container } = render(
      <TablePreview
        columns={q.tableColumns}
        rows={q.tableRowsData}
        choiceControlType={(cell) => getGroupTypeOfCell(q, cell.id)}
      />,
    );
    const radios = container.querySelectorAll('input[type="radio"]');
    const checks = container.querySelectorAll('input[type="checkbox"]');
    expect(radios.length).toBe(1);
    expect(checks.length).toBe(1);
    // 라벨도 함께 표시
    expect(within(container).getByText('단일')).toBeTruthy();
    expect(within(container).getByText('복수')).toBeTruthy();
  });
});
