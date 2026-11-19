import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MobileRowWiseOriginalSheet } from '@/features/question-renderer/mobile-row-wise-original-sheet';
import type {
  MobileRowWiseOriginalModel,
  MobileRowWiseOriginalQuestion,
} from '@/features/question-renderer/utils/mobile-row-wise-original';

// 명단 값이 있는 응답자 — 행 글자 칸의 `{{멘토1}}` 이 줄 제목으로 올라와도 이름으로 바뀌어야 한다
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({ 멘토1: '김하나' }),
  useAnswerQuotes: () => ({ 분야: '인공지능' }),
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
  const cell = { id: `${rowId}-answer`, type: 'input' as const, content: '' };
  return {
    rowId,
    title,
    omittedAnswerCells: [],
    projection: {
      columns: [{ id: 'answer', label: '응답', width: 240 }],
      row: { id: rowId, label: title, cells: [cell] },
      repeatedRows: [],
      showColumnHeader: true,
      hasInteractiveCells: true,
      sourceRowIdByCellId: new Map([[cell.id, rowId]]),
    },
  };
}

const model: MobileRowWiseOriginalModel = {
  sections: [
    {
      id: 'method',
      label: '{{멘토1}} 멘토의 멘토링 방법',
      subgroups: [
        {
          id: 'sub',
          label: '{{{분야}}} 분야',
          questions: [
            question('row-1', '{{멘토1}} 멘토의 멘토링 주기가 적절하였다'),
            question('row-2', '{{없는열}} 멘토는 성실하였다'),
          ],
        },
      ],
    },
  ],
};

describe('MobileRowWiseOriginalSheet — 명단 토큰', () => {
  it('섹션·하위 그룹·줄 제목의 명단 토큰과 응답 인용을 값으로 바꿔 그린다', () => {
    render(
      <MobileRowWiseOriginalSheet
        model={model}
        errorCellIds={new Set(['row-1-answer'])}
        renderCell={(_cell, rowQuestion, _scope, _invalid, errorDescriptionId) => (
          <input aria-label={`${rowQuestion.title} 응답`} aria-describedby={errorDescriptionId} />
        )}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: '김하나 멘토의 멘토링 방법' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: '인공지능 분야' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '김하나 멘토의 멘토링 주기가 적절하였다' })).toBeInTheDocument();
    // 없는 열은 다른 화면과 같이 빈 글자
    expect(screen.getByRole('group', { name: '멘토는 성실하였다' })).toBeInTheDocument();
    // 호스트가 받는 줄 제목(접근성 이름·오류 안내)도 바뀐 글자다
    expect(
      screen.getByRole('textbox', { name: '김하나 멘토의 멘토링 주기가 적절하였다 응답' }),
    ).toHaveAccessibleDescription('김하나 멘토의 멘토링 주기가 적절하였다의 응답을 확인해 주세요.');
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });
});
