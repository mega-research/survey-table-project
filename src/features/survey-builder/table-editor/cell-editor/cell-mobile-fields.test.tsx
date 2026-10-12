import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CellMobileFields } from '@/features/survey-builder/table-editor/cell-editor/cell-mobile-fields';
import { cellToFormState } from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import type { CellFormSetters } from '@/features/survey-builder/table-editor/cell-editor/hooks/use-cell-form';

const setters = { setMobileDisplay: vi.fn(), setMobileLabel: vi.fn() } as unknown as CellFormSetters;

function renderFields(o: { type: 'text' | 'input'; count?: number; checked?: boolean; onChange?: (v: boolean) => void }) {
  return render(
    <CellMobileFields
      form={cellToFormState({ id: 'c', type: o.type, content: '설명' })}
      setters={setters}
      showContentMobileDisplay={o.type === 'text'}
      showInteractiveMobileLabel={o.type === 'input'}
      columnApplyCount={o.count}
      applyToColumn={o.checked ?? false}
      onApplyToColumnChange={o.onChange ?? vi.fn()}
    />,
  );
}

describe('셀 모달 「모바일 카드 표시」 — 열 일괄 적용', () => {
  it('표시 셀이면 대상 수와 함께 체크를 보여 준다', () => {
    const onChange = vi.fn();
    renderFields({ type: 'text', count: 9, onChange });

    const box = screen.getByRole('checkbox', { name: /같은 열의 다른 표시 셀에도 적용 \(9개\)/ });
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('적용할 다른 셀이 없으면 체크를 보여 주지 않는다', () => {
    renderFields({ type: 'text', count: 0 });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('입력 셀에는 체크가 없다', () => {
    renderFields({ type: 'input', count: 5 });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
