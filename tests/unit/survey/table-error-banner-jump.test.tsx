import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 차단형 검증 오류 배너의 "위치로 이동" 버튼.
 * 자동 스크롤 대신 배너 버튼을 눌러 위반 셀(data-cell-id)로 스크롤한다.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
}));

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 120 },
  { id: 'c1', label: '값', width: 120 },
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'r1c0', type: 'text', content: '매출' },
      { id: 'r1c1', type: 'input', content: '', inputType: 'number' },
    ],
  },
] as unknown as TableRow[];

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

describe('InteractiveTableResponse 오류 배너', () => {
  it('cellIds 항목은 "위치로 이동" 버튼을 렌더하고, 클릭 시 해당 셀로 스크롤한다', () => {
    const scrollSpy = vi.fn();
    // jsdom 은 scrollIntoView 를 정의하지 않으므로 프로토타입에 스텁
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[{ message: '선택된 셀 합계가 100이 되어야 합니다 (현재 120)', cellIds: ['r1c1'] }]}
        errorCellIds={new Set(['r1c1'])}
      />,
    );

    expect(
      screen.getByText('선택된 셀 합계가 100이 되어야 합니다 (현재 120)'),
    ).toBeInTheDocument();
    const jumpBtn = screen.getByRole('button', { name: '위치로 이동' });
    fireEvent.click(jumpBtn);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-cell-id')).toBe('r1c1');
  });

  it('cellIds[0] 이 미렌더(열 displayCondition 으로 숨은 열)여도 렌더된 첫 셀로 스크롤한다', () => {
    // 회귀: 합계 검증은 allResponses 접근이 없어 숨은 열 셀을 못 거른다 → cellIds[0] 이
    // 미렌더 셀일 수 있고, 그 경우 이전 코드는 querySelector 가 못 찾아 무반응이었다.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[
          { message: '합계 오류', cellIds: ['col-hidden-not-rendered', 'r1c1'] },
        ]}
        errorCellIds={new Set(['r1c1'])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '위치로 이동' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // 미렌더 cellIds[0] 을 건너뛰고 실제 렌더된 r1c1 로 스크롤
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-cell-id')).toBe('r1c1');
  });

  it('렌더된 셀이 하나도 없으면(모두 미렌더) 조용히 무시한다', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[{ message: '합계 오류', cellIds: ['nope-1', 'nope-2'] }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '위치로 이동' }));
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('cellIds 가 없거나 빈 항목은 이동 버튼 없이 메시지만 표시한다', () => {
    render(
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        onChange={() => {}}
        errorItems={[{ message: '메시지만' }, { message: '빈 배열', cellIds: [] }]}
      />,
    );
    expect(screen.getByText('메시지만')).toBeInTheDocument();
    expect(screen.getByText('빈 배열')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '위치로 이동' })).toBeNull();
  });
});
