import { describe, it, expect } from 'vitest';

import { collectGatingDiagnostics } from '@/lib/survey/cell-gating-diagnostics';
import type { Question, TableCell, TableRow } from '@/types/survey';

function makeQuestion(rows: TableRow[]): Question {
  return {
    id: 'q1',
    surveyId: 's1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: rows,
  } as unknown as Question;
}

function row(id: string, cells: TableCell[]): TableRow {
  return { id, label: id, cells } as TableRow;
}

const ctrl: TableCell = {
  id: 'ctrl',
  type: 'radio',
  content: '',
  radioOptions: [
    { id: 'o1', label: '수행', value: '1' },
    { id: 'o2', label: '미수행', value: '2' },
  ],
};

function gatedInput(id: string, controllerCellId: string, extra?: Partial<TableCell>): TableCell {
  return {
    id,
    type: 'input',
    content: '',
    inputType: 'number',
    enabledWhen: { kind: 'option', controllerCellId, values: ['1'] },
    ...extra,
  } as TableCell;
}

describe('collectGatingDiagnostics — 진단 5종', () => {
  it('정상 설정(같은 행 컨트롤러)은 진단이 없다', () => {
    const q = makeQuestion([row('r1', [ctrl, gatedInput('in1', 'ctrl')])]);
    expect(collectGatingDiagnostics([q])).toEqual([]);
  });

  it('존재하지 않는 컨트롤러 → gating-broken-ref', () => {
    const q = makeQuestion([row('r1', [ctrl, gatedInput('in1', 'ghost')])]);
    const out = collectGatingDiagnostics([q]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('gating-broken-ref');
    expect(out[0]!.cellId).toBe('in1');
  });

  it('병합으로 숨겨진 컨트롤러 → gating-hidden-controller', () => {
    const hiddenCtrl: TableCell = { ...ctrl, isHidden: true };
    const q = makeQuestion([row('r1', [hiddenCtrl, gatedInput('in1', 'ctrl')])]);
    const out = collectGatingDiagnostics([q]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('gating-hidden-controller');
    expect(out[0]!.cellId).toBe('in1');
  });

  it('다른 행의 컨트롤러 → gating-cross-row-ref', () => {
    const q = makeQuestion([
      row('r1', [ctrl]),
      row('r2', [gatedInput('in2', 'ctrl')]),
    ]);
    const out = collectGatingDiagnostics([q]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('gating-cross-row-ref');
  });

  it('자기 자신 참조 → gating-self-ref', () => {
    const q = makeQuestion([row('r1', [gatedInput('in1', 'in1')])]);
    const out = collectGatingDiagnostics([q]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('gating-self-ref');
  });

  it('filled 상호 참조 순환 → gating-cycle 1건으로 접힌다', () => {
    const a: TableCell = {
      id: 'a',
      type: 'input',
      content: '',
      enabledWhen: { kind: 'filled', controllerCellId: 'b' },
    } as TableCell;
    const b: TableCell = {
      id: 'b',
      type: 'input',
      content: '',
      enabledWhen: { kind: 'filled', controllerCellId: 'a' },
    } as TableCell;
    const q = makeQuestion([row('r1', [a, b])]);
    const out = collectGatingDiagnostics([q]);
    expect(out.filter((d) => d.kind === 'gating-cycle')).toHaveLength(1);
  });

  it('prefill 셀에 게이팅 → gating-prefill-conflict', () => {
    const q = makeQuestion([
      row('r1', [ctrl, gatedInput('in1', 'ctrl', { defaultValueTemplate: '{{인원}}' })]),
    ]);
    const out = collectGatingDiagnostics([q]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('gating-prefill-conflict');
  });

  it('컨트롤러를 가리키는 정상 체인(A→B→C)은 순환이 아니다', () => {
    const c: TableCell = { id: 'c', type: 'input', content: '' } as TableCell;
    const b: TableCell = {
      id: 'b',
      type: 'input',
      content: '',
      enabledWhen: { kind: 'filled', controllerCellId: 'c' },
    } as TableCell;
    const a: TableCell = {
      id: 'a',
      type: 'input',
      content: '',
      enabledWhen: { kind: 'filled', controllerCellId: 'b' },
    } as TableCell;
    const q = makeQuestion([row('r1', [a, b, c])]);
    expect(collectGatingDiagnostics([q])).toEqual([]);
  });
});
