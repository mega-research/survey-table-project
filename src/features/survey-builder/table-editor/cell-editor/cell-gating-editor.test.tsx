import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CellGatingEditor } from '@/features/survey-builder/table-editor/cell-editor/cell-gating-editor';
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

  it('보기 옵션 셀도 후보가 되고, 고르면 "선택 시 활성" 조건이 된다', () => {
    const other: TableCell = { id: 'opt-other', type: 'choice_opt', content: '⑧ 기타' };
    const { onConditionChange } = renderEditor({
      rowCells: [self],
      otherRows: [{ id: 'r8', label: '기타', cells: [other] }],
    });
    fireEvent.click(screen.getByLabelText('다른 셀 값에 따라 활성화'));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'choice-selected',
      controllerCellId: 'opt-other',
    });
  });

  it('보기 옵션 컨트롤러는 라벨에 보기 텍스트가 붙고 설명 문구가 보인다', () => {
    const other: TableCell = { id: 'opt-other', type: 'choice_opt', content: '⑧ 기타' };
    renderEditor({
      condition: { kind: 'choice-selected', controllerCellId: 'opt-other' },
      rowCells: [self],
      otherRows: [{ id: 'r8', label: '기타', cells: [other] }],
    });
    expect(screen.getByRole('combobox')).toHaveTextContent('기타 · 보기 옵션: ⑧ 기타');
    expect(screen.getByText(/이 보기가 선택되면 활성됩니다/)).toBeInTheDocument();
  });

  it('표에 컨트롤러 후보가 없으면 토글이 비활성이고 안내가 보인다', () => {
    renderEditor({ rowCells: [self, { id: 't', type: 'text', content: '라벨' }] });
    expect(
      (screen.getByLabelText('다른 셀 값에 따라 활성화') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/설정할 수 없습니다/)).toBeTruthy();
  });
});

describe('CellGatingEditor — 조건 묶음 (AND / OR / NOT, 중첩)', () => {
  afterEach(cleanup);

  const now: TableCell = { id: 'now', type: 'input', content: '', exportLabel: '현재 보유 규모' };
  const want: TableCell = { id: 'want', type: 'input', content: '', exportLabel: '희망 규모' };
  const gte1 = (id: string): CellEnableCondition => ({
    kind: 'numeric',
    controllerCellId: id,
    op: '>=',
    value: 1,
  });

  it('단일 조건에서 "조건 추가" 를 누르면 AND 묶음으로 승격한다', () => {
    const { onConditionChange } = renderEditor({ condition: gte1('now'), rowCells: [now, want, self] });
    fireEvent.click(screen.getByRole('button', { name: /조건 추가/ }));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'group',
      op: 'AND',
      terms: [gte1('now'), { kind: 'filled', controllerCellId: 'now' }],
    });
  });

  it('묶음의 결합 방식을 OR 로 바꾼다', () => {
    const group: CellEnableCondition = { kind: 'group', op: 'AND', terms: [gte1('now'), gte1('want')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    fireEvent.change(screen.getByLabelText('조건 결합 방식'), { target: { value: 'OR' } });
    expect(onConditionChange).toHaveBeenCalledWith({ ...group, op: 'OR' });
  });

  it('묶음 안 두 번째 조건의 컨트롤러를 바꾸면 그 조건만 바뀐다', () => {
    const group: CellEnableCondition = { kind: 'group', op: 'OR', terms: [gte1('now'), gte1('now')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    fireEvent.change(screen.getAllByLabelText('컨트롤러')[1]!, { target: { value: 'want' } });
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'group',
      op: 'OR',
      terms: [gte1('now'), { kind: 'filled', controllerCellId: 'want' }],
    });
  });

  it('조건이 하나만 남으면 단일 조건으로 되돌아간다', () => {
    const group: CellEnableCondition = { kind: 'group', op: 'OR', terms: [gte1('now'), gte1('want')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    fireEvent.click(screen.getAllByLabelText('항 삭제')[0]!);
    expect(onConditionChange).toHaveBeenCalledWith(gte1('want'));
  });

  it('NOT 묶음은 조건이 하나만 남아도 묶음으로 둔다 — 부정의 뜻이 사라지면 안 된다', () => {
    const group: CellEnableCondition = { kind: 'group', op: 'NOT', terms: [gte1('now'), gte1('want')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    fireEvent.click(screen.getAllByLabelText('항 삭제')[1]!);
    expect(onConditionChange).toHaveBeenCalledWith({ kind: 'group', op: 'NOT', terms: [gte1('now')] });
    expect(screen.getByText(/처음 상태에서 이\s+묶음은 충족/)).toBeTruthy();
  });

  it('"하위 묶음 추가" 는 바깥과 다른 결합 방식의 묶음을 조건으로 넣는다', () => {
    const group: CellEnableCondition = { kind: 'group', op: 'AND', terms: [gte1('now'), gte1('want')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    fireEvent.click(screen.getByRole('button', { name: /하위 묶음 추가/ }));
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'group',
      op: 'AND',
      terms: [
        gte1('now'),
        gte1('want'),
        { kind: 'group', op: 'OR', terms: [{ kind: 'filled', controllerCellId: 'now' }] },
      ],
    });
  });

  it('중첩 묶음 안의 조건을 고치면 바깥 구조는 그대로다', () => {
    const inner: CellEnableCondition = { kind: 'group', op: 'OR', terms: [gte1('now'), gte1('want')] };
    const group: CellEnableCondition = { kind: 'group', op: 'AND', terms: [inner, gte1('now')] };
    const { onConditionChange } = renderEditor({ condition: group, rowCells: [now, want, self] });
    // 결합 방식 select 는 바깥·안쪽 순서로 둘
    fireEvent.change(screen.getAllByLabelText('조건 결합 방식')[1]!, { target: { value: 'NOT' } });
    expect(onConditionChange).toHaveBeenCalledWith({
      kind: 'group',
      op: 'AND',
      terms: [{ ...inner, op: 'NOT' }, gte1('now')],
    });
  });

  it('조건이 없는 묶음은 경고를 보여준다', () => {
    renderEditor({ condition: { kind: 'group', op: 'OR', terms: [] }, rowCells: [now, want, self] });
    expect(screen.getByText(/조건이 없는 묶음은 항상 충족/)).toBeTruthy();
  });
});
