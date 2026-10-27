/**
 * 모바일 표 스테퍼 — 다국어 설문의 현재 언어로 고르기 안내·상세 입력 버튼·이동 버튼을 그린다.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileTableStepper } from '@/features/question-renderer/mobile-table-stepper';
import { SurveyLocaleProvider } from '@/features/question-renderer/survey-locale-context';
import type { TableColumn, TableRow } from '@/types/survey';

vi.mock('@/features/question-renderer/mobile-row-card', () => ({
  MobileRowCard: ({ row }: { row: { id: string } }) => <div data-testid={`row-card-${row.id}`} />,
}));

const visibleColumns: TableColumn[] = [
  { id: 'c0', label: 'Item' },
  { id: 'c1', label: 'Value' },
];

/** 큰 표(행 18개, rowspan 없음) — 행 고르기 단계로 시작한다. */
const rows: TableRow[] = Array.from({ length: 18 }, (_, i) => ({
  id: `r${i}`,
  label: `Row ${i}`,
  cells: [
    { id: `r${i}c0`, type: 'text', content: `Row ${i}` },
    { id: `r${i}c1`, type: 'input', content: '' },
  ],
}));

afterEach(cleanup);

describe('MobileTableStepper 현재 언어', () => {
  it('中文 — 행 고르기 안내와 상세 입력 버튼, 상세 화면의 이동 버튼이 중국어다', () => {
    const { container } = render(
      <SurveyLocaleProvider locale="zh">
        <MobileTableStepper
          questionId="q1"
          displayRows={rows}
          visibleColumns={visibleColumns}
          visibleHeaderGrid={null}
          currentResponse={{}}
          hideColumnLabels={false}
          value={{}}
          onChange={() => {}}
          hasDynamicRows={false}
          selectedRowIds={[]}
          groupConfigMap={new Map()}
          onSelectGroup={() => {}}
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('请选择细项')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Row 1'));
    fireEvent.click(screen.getByRole('button', { name: /详细填写（已选1项）/ }));
    expect(screen.getByRole('button', { name: /返回项目选择/ })).toBeInTheDocument();
    expect(screen.getByText('已完成 0 / 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上一步/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/[가-힣]/);
  });
});
