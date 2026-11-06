import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorTableRow } from '@/features/survey-builder/table-editor/editor-table-row';
import type { TableRow } from '@/types/survey';

/** 안 쓴 행 빼기 — 행 설정 메뉴의 체크박스 (2026-11-06, 열 설정 메뉴와 같은 모양). */
const row: TableRow = { id: 'r1', label: '기타1', cells: [{ id: 'c1', type: 'input', content: '' }] } as TableRow;

function renderRow(overrides: Partial<React.ComponentProps<typeof EditorTableRow>> = {}) {
  const noop = vi.fn();
  return render(
    <EditorTableRow
      row={row}
      rowIndex={3}
      columnWidths={[120]}
      columnCount={1}
      totalRowCount={5}
      hasQuestions={false}
      hasCopiedCell={false}
      hasCopiedRegion={false}
      isDragCopyActive={false}
      dragSelectionCellsKey=""
      onStartDragCopy={noop}
      onUpdateRowLabel={noop}
      onUpdateRowCode={noop}
      dynamicRowConfigs={[]}
      onSetDynamicGroupId={noop}
      onSetShowWhenDynamicGroupId={noop}
      onMoveRow={noop}
      onDuplicateRow={noop}
      onDeleteRow={noop}
      onSelectCell={noop}
      onMoveColumn={noop}
      onDeleteCell={noop}
      onCopyCell={noop}
      onPasteCell={noop}
      onSaveCell={noop}
      onLoadCell={noop}
      {...overrides}
    />,
  );
}

describe('EditorTableRow 안 쓴 행 빼기', () => {
  it('행 설정에서 체크하면 그 행 인덱스로 켠다', async () => {
    const onUpdateRowExportOmit = vi.fn();
    renderRow({ onUpdateRowExportOmit });
    await userEvent.click(screen.getByTitle('행 설정'));
    await userEvent.click(await screen.findByRole('checkbox', { name: /안 쓰면 내보내기에서 빼기/ }));
    expect(onUpdateRowExportOmit).toHaveBeenCalledWith(3, true);
  });

  it('콜백을 주지 않으면 체크박스를 내지 않는다', async () => {
    renderRow();
    await userEvent.click(screen.getByTitle('행 설정'));
    await screen.findByPlaceholderText('행 코드');
    expect(screen.queryByRole('checkbox', { name: /안 쓰면 내보내기에서 빼기/ })).toBeNull();
  });
});
