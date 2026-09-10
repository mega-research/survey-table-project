import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CellGatingEditor } from '@/components/survey-builder/cell-gating-editor';
import type { CellEnableCondition, TableCell, TableRow } from '@/types/survey';

const ctrl: TableCell = {
  id: 'ctrl',
  type: 'radio',
  content: '',
  exportLabel: '항목_수행여부',
  radioOptions: [
    { id: 'o1', label: '수행', value: '1' },
    { id: 'o2', label: '미수행', value: '2' },
  ],
};

const self: TableCell = { id: 'self', type: 'input', content: '', inputType: 'number' };

const inputCtrl: TableCell = { id: 'in-ctrl', type: 'input', content: '', exportLabel: '인원' };

function renderEditor(overrides?: {
  condition?: CellEnableCondition;
  rowCells?: TableCell[];
  /** 같은 행 외의 행들 — 컨트롤러는 표 안 어느 행이든 된다 */
  otherRows?: TableRow[];
}) {
  const onConditionChange = vi.fn();
  const onRequiredWhenEnabledChange = vi.fn();
  const ownRow: TableRow = { id: 'r-self', label: '이 행', cells: overrides?.rowCells ?? [ctrl, self] };
  render(
    <CellGatingEditor
      cellId="self"
      rows={[ownRow, ...(overrides?.otherRows ?? [])]}
      condition={overrides?.condition}
      requiredWhenEnabled={false}
      onConditionChange={onConditionChange}
      onRequiredWhenEnabledChange={onRequiredWhenEnabledChange}
    />,
  );
  return { onConditionChange, onRequiredWhenEnabledChange };
}

describe('CellGatingEditor', () => {
  afterEach(cleanup);

  it('토글을 켜면 첫 컨트롤러(선택형) 기준 option 조건이 생성된다', () => {
    const { onConditionChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('다른 셀 값에 따라 활성화'));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'option',
      controllerCellId: 'ctrl',
      values: [],
    });
  });

  it('선택형 컨트롤러의 옵션을 체크하면 values 에 응답값이 담긴다', () => {
    const { onConditionChange } = renderEditor({
      condition: { kind: 'option', controllerCellId: 'ctrl', values: [] },
    });
    fireEvent.click(screen.getByLabelText('수행'));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'option',
      controllerCellId: 'ctrl',
      values: ['1'],
    });
  });

  it('옵션 미선택이면 항상 비활성 경고를 보여준다', () => {
    renderEditor({ condition: { kind: 'option', controllerCellId: 'ctrl', values: [] } });
    expect(screen.getByText(/항상 비활성/)).toBeTruthy();
  });

  it('input 컨트롤러는 값 존재/숫자 비교 선택지를 보여주고 numeric 전환이 동작한다', () => {
    const { onConditionChange } = renderEditor({
      rowCells: [inputCtrl, self],
      condition: { kind: 'filled', controllerCellId: 'in-ctrl' },
    });
    fireEvent.click(screen.getByLabelText('숫자 비교'));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'numeric',
      controllerCellId: 'in-ctrl',
      op: '>=',
      value: 1,
    });
  });

  it('활성화되면 필수 체크박스가 requiredWhenEnabled 콜백을 부른다', () => {
    const { onRequiredWhenEnabledChange } = renderEditor({
      condition: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
    });
    fireEvent.click(screen.getByLabelText('활성화되면 필수'));
    expect(onRequiredWhenEnabledChange).toHaveBeenCalledWith(true);
  });

  it('다른 행의 컨트롤러도 후보에 오르고 행 라벨이 앞에 붙는다', () => {
    renderEditor({
      condition: { kind: 'option', controllerCellId: 'ctrl', values: [] },
      otherRows: [
        {
          id: 'r2',
          label: '2행',
          cells: [{ ...ctrl, id: 'ctrl2', exportLabel: '다른행_수행여부' }],
        },
      ],
    });
    const select = screen.getByRole('combobox');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['항목_수행여부', '2행 · 다른행_수행여부']);
  });

  it('같은 행에 후보가 없어도 다른 행에 있으면 설정할 수 있다', () => {
    const { onConditionChange } = renderEditor({
      rowCells: [self],
      otherRows: [{ id: 'r2', label: '2행', cells: [ctrl] }],
    });
    fireEvent.click(screen.getByLabelText('다른 셀 값에 따라 활성화'));
    expect(onConditionChange).toHaveBeenCalledWith({ kind: 'option', controllerCellId: 'ctrl', values: [] });
  });

  it('행 반복 1벌(템플릿) 행은 행 라벨로 후보에 오른다 — 2벌 이후는 모달이 접어서 넘긴다', () => {
    renderEditor({
      condition: { kind: 'option', controllerCellId: 'ctrl', values: [] },
      otherRows: [{ id: 'r1b', label: '항목', cells: [{ ...ctrl, id: 'ctrl-b1' }], repeatIndex: 1 } as TableRow],
    });
    const labels = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['항목_수행여부', '항목 · 항목_수행여부']);
  });

  it('표에 컨트롤러 후보가 없으면 토글이 비활성이고 안내가 보인다', () => {
    renderEditor({ rowCells: [self, { id: 't', type: 'text', content: '라벨' }] });
    expect(
      (screen.getByLabelText('다른 셀 값에 따라 활성화') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/설정할 수 없습니다/)).toBeTruthy();
  });
});
