import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractiveCell } from '@/features/question-renderer/cells/interactive-cell';
import type { TableCell } from '@/types/survey';

/**
 * 표 드롭다운 보기 표시 조건 — 실제 셀 컨테이너를 거쳐 (2026-11-06, 유가공업 문3 설비구분 → 주요 설비명).
 */
afterEach(cleanup);

const category: TableCell = {
  id: 'cat',
  content: '',
  type: 'select',
  selectOptions: [
    { id: 'c1', label: '원유 수취·저장', value: '1' },
    { id: 'c3', label: '살균·멸균', value: '3' },
  ],
};
const name: TableCell = {
  id: 'name',
  content: '',
  type: 'select',
  selectOptions: [
    { id: 'n11', label: '원유 수취탱크', value: '11', enabledWhen: { kind: 'option', controllerCellId: 'cat', values: ['1'] } },
    { id: 'n31', label: 'HTST 살균기', value: '31', enabledWhen: { kind: 'option', controllerCellId: 'cat', values: ['3'] } },
    { id: 'n99', label: '기타(직접입력)', value: '99' },
  ],
};
const rowCells = [category, name];

function Host() {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      {rowCells.map((cell) => (
        <div key={cell.id} data-testid={`cell-${cell.id}`}>
          <InteractiveCell cell={cell} questionId="q3" value={value} onChange={setValue} rowCells={rowCells} />
        </div>
      ))}
      <output data-testid="stored">{JSON.stringify(value)}</output>
    </>
  );
}

const optionLabels = (cellId: string) =>
  [...screen.getByTestId(`cell-${cellId}`).querySelectorAll('option')].map((o) => o.textContent);
const selectOf = (cellId: string) =>
  screen.getByTestId(`cell-${cellId}`).querySelector('select') as HTMLSelectElement;

describe('드롭다운 보기 표시 조건', () => {
  it('구분을 고르기 전에는 조건 없는 보기만, 고르면 그 구분의 보기가 보인다', () => {
    render(<Host />);
    expect(optionLabels('name')).not.toContain('HTST 살균기');
    expect(optionLabels('name')).toContain('기타(직접입력)');

    fireEvent.change(selectOf('cat'), { target: { value: '3' } });
    expect(optionLabels('name')).toContain('HTST 살균기');
    expect(optionLabels('name')).not.toContain('원유 수취탱크');
  });

  it('구분을 바꾸면 숨은 설비명은 지워지고, 조건 없는 「기타」는 남는다', () => {
    render(<Host />);
    fireEvent.change(selectOf('cat'), { target: { value: '3' } });
    fireEvent.change(selectOf('name'), { target: { value: '31' } });
    expect(JSON.parse(screen.getByTestId('stored').textContent!)).toEqual({ cat: '3', name: '31' });

    fireEvent.change(selectOf('cat'), { target: { value: '1' } });
    expect(JSON.parse(screen.getByTestId('stored').textContent!)).not.toHaveProperty('name');

    fireEvent.change(selectOf('name'), { target: { value: '99' } });
    fireEvent.change(selectOf('cat'), { target: { value: '3' } });
    expect(JSON.parse(screen.getByTestId('stored').textContent!)).toMatchObject({ name: '99' });
  });
});
