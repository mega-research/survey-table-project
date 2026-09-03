import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MobileRowWiseOriginalSheet } from '@/features/question-renderer/mobile-row-wise-original-sheet';
import type {
  MobileRowWiseOriginalModel,
  MobileRowWiseOriginalQuestion,
} from '@/features/question-renderer/utils/mobile-row-wise-original';

vi.mock('@/features/question-renderer/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

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

function question(rowId: string, title: string): MobileRowWiseOriginalQuestion {
  const sharedCell = { id: 'shared-answer', type: 'input' as const, content: '' };
  return {
    rowId,
    title,
    projection: {
      columns: [{ id: 'answer', label: '응답', width: 240 }],
      row: { id: rowId, label: title, cells: [sharedCell] },
      repeatedRows: [],
      showColumnHeader: true,
      hasInteractiveCells: true,
      sourceRowIdByCellId: new Map([['shared-answer', 'source-row']]),
    },
  };
}

const model: MobileRowWiseOriginalModel = {
  sections: [{
    id: 'employment',
    label: '취업 현황',
    subgroups: [
      { id: 'career', label: '직무 · 진로설정', questions: [question('row-1', '직무')] },
      { id: 'mentor', label: '', questions: [question('row-2', '멘토링')] },
    ],
  }],
};

describe('MobileRowWiseOriginalSheet', () => {
  it('드릴다운 shell 없이 모든 행 문항을 하나의 연속 시트와 독립 입력 그룹으로 나열한다', () => {
    render(
      <MobileRowWiseOriginalSheet
        model={model}
        renderCell={(cell, rowQuestion) => (
          <input aria-label={`${rowQuestion.title} 응답`} data-logical-cell-id={cell.id} />
        )}
      />,
    );

    expect(screen.getByTestId('mobile-row-wise-original-sheet')).toBeInTheDocument();
    expect(screen.getByText('취업 현황')).toBeInTheDocument();
    expect(screen.getByText('직무 · 진로설정')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '직무' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '멘토링' })).toBeInTheDocument();
    expect(screen.getAllByTestId('table-preview-scroll')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /뒤로|목차로|다음 섹션/ })).toBeNull();
    expect(screen.queryByText(/전체 \d+ \/ \d+/)).toBeNull();
  });

  it('같은 논리 셀을 표시한 행마다 고유 표시 인스턴스를 부여하고 오류 행만 강조한다', () => {
    render(
      <MobileRowWiseOriginalSheet
        model={model}
        errorCellIds={new Set(['shared-answer'])}
        renderCell={(cell) => <input aria-label={cell.id} />}
      />,
    );

    const logicalCells = document.querySelectorAll('[data-cell-id="shared-answer"]');
    expect(logicalCells).toHaveLength(2);
    expect(
      [...logicalCells].map((cell) => cell.getAttribute('data-cell-instance-id')),
    ).toEqual(['row-1:row-1:shared-answer', 'row-2:row-2:shared-answer']);
    expect(screen.getByText('직무')).toHaveClass('text-red-700');
    expect(screen.getByText('멘토링')).toHaveClass('text-red-700');
  });
});
