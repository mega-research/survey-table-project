import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyTable,
  decideDrilldown,
  type ClassifyInput,
} from '@/utils/classify-table';
import type { TableCell, TableColumn, TableRow, HeaderCell } from '@/types/survey';

// ── 셀/열/헤더 빌더 (디자인 핸드오프와 동일 의미) ──
let _id = 0;
const cid = () => 'c' + ++_id;
const T = (content: string, o: { rs?: number; cs?: number } = {}): TableCell => ({
  id: cid(),
  type: 'text',
  content,
  rowspan: o.rs,
  colspan: o.cs,
});
const H = (): TableCell => ({ id: cid(), type: 'text', content: '', isHidden: true });
const I = (id: string, o: { cs?: number; ph?: string } = {}): TableCell => ({
  id,
  type: 'input',
  inputType: 'number',
  content: '',
  colspan: o.cs,
  placeholder: o.ph ?? 'ex) 100',
});
const C = (label: string): TableColumn => ({ id: cid(), label });
const HC = (label: string, cs = 1, rs = 1): HeaderCell => ({ id: cid(), label, colspan: cs, rowspan: rs });

// ── 표 1: GPU 향후 희망 (제조사 rowspan ▸ 모델, 값 열 1) ──
function gpu(): ClassifyInput {
  return {
    tableColumns: [C('제조사'), C('GPU 모델'), C('향후 희망 규모')],
    tableRowsData: [
      { id: 'r1', label: '', cells: [T('NVIDIA', { rs: 3 }), T('H100'), I('gpu-h100')] },
      { id: 'r2', label: '', cells: [H(), T('A100'), I('gpu-a100')] },
      { id: 'r3', label: '', cells: [H(), T('L4'), I('gpu-l4')] },
      { id: 'r4', label: '', cells: [T('AMD', { rs: 2 }), T('MI300X'), I('gpu-mi300x')] },
      { id: 'r5', label: '', cells: [H(), T('MI250X'), I('gpu-mi250x')] },
    ],
  };
}

// ── 표 2: 종사자 교차표 (품목 ▸ 직군(남/여) 다단 헤더) ──
function workers(): ClassifyInput {
  const cols = [C('생산품목'), C('구분'), C('연령'), C('남'), C('여'), C('남'), C('여')];
  const grid: HeaderCell[][] = [
    [HC('구분', 3, 2), HC('사무직', 2), HC('생산직', 2)],
    [HC('남'), HC('여'), HC('남'), HC('여')],
  ];
  const ages = ['29세 이하', '30~39세', '40~49세'];
  const rows: TableRow[] = [];
  ([['① 제재목', 'je'], ['② 합판', 'hp']] as const).forEach(([item, key]) => {
    ages.forEach((age, ai) => {
      const c0 = ai === 0 ? T(item, { rs: 3 }) : H();
      const c1 = ai === 0 ? T('연령별', { rs: 3 }) : H();
      rows.push({
        id: `${key}-${ai}`,
        label: '',
        cells: [c0, c1, T(age), I(`${key}-${ai}-om`), I(`${key}-${ai}-of`), I(`${key}-${ai}-dm`), I(`${key}-${ai}-df`)],
      });
    });
  });
  return { tableColumns: cols, tableRowsData: rows, tableHeaderGrid: grid };
}

// ── 표 3: 숯·목초액 혼합 (MATRIX + SCALAR + SCALAR) ──
function charcoal(): ClassifyInput {
  const cols = [C('구분'), C('방식'), C('종류'), C('용량'), C('개수'), C('용량'), C('개수')];
  const grid: HeaderCell[][] = [
    [HC('구분', 3, 2), HC('시설 1', 2), HC('시설 2', 2)],
    [HC('용량'), HC('개수'), HC('용량'), HC('개수')],
  ];
  const r = (id: string, c0: TableCell, c1: TableCell, name: string): TableRow => ({
    id,
    label: '',
    cells: [c0, c1, T(name), I(`${id}-1c`), I(`${id}-1q`), I(`${id}-2c`), I(`${id}-2q`)],
  });
  const rows: TableRow[] = [
    r('s1-heuk', T('1) 생산방식별 시설 용량 및 개수', { rs: 5 }), T('전통식 가마', { rs: 3 }), '흑탄'),
    r('s1-baek', H(), H(), '백탄'),
    r('s1-top', H(), H(), '톱밥숯'),
    r('s1-chip', H(), T('기계식 탄화로', { rs: 2 }), '칩'),
    r('s1-bam', H(), H(), '대나무'),
    { id: 's2-charcoal', label: '', cells: [T('2) 연간 최대 생산 가능량', { rs: 2 }), T('숯', { cs: 2 }), H(), I('s2-charcoal', { cs: 4, ph: 'ex) 1000' }), H(), H(), H()] },
    { id: 's2-vinegar', label: '', cells: [H(), T('목초액 (죽초액)', { cs: 2 }), H(), I('s2-vinegar', { cs: 4, ph: 'ex) 1000' }), H(), H(), H()] },
    { id: 's3-days', label: '', cells: [T('3) 월평균 가동일 수', { cs: 3 }), H(), H(), I('s3-days', { cs: 4, ph: 'ex) 22' }), H(), H(), H()] },
  ];
  return { tableColumns: cols, tableRowsData: rows, tableHeaderGrid: grid };
}

// ── 표 4: 평면 단순 (라벨 1열 + 값 1열, rowspan 없음) ──
function flatSimple(): ClassifyInput {
  return {
    tableColumns: [C('항목'), C('점수')],
    tableRowsData: [
      { id: 'f1', label: '', cells: [T('가격'), I('f1-v')] },
      { id: 'f2', label: '', cells: [T('품질'), I('f2-v')] },
      { id: 'f3', label: '', cells: [T('서비스'), I('f3-v')] },
    ],
  };
}

// ── 표 5: 큰 list (입력 16개 → 드릴다운 임계 초과) ──
function bigList(): ClassifyInput {
  const n = 16;
  return {
    tableColumns: [C('그룹'), C('항목'), C('값')],
    tableRowsData: Array.from({ length: n }, (_, i) => ({
      id: `bl${i}`,
      label: '',
      cells: [i === 0 ? T('그룹', { rs: n }) : H(), T(`항목${i}`), I(`bl${i}-v`)],
    })),
  };
}

beforeEach(() => {
  _id = 0;
});

describe('classifyTable — GPU (LIST)', () => {
  it('제조사 rowspan 블록이 섹션, 각 섹션은 list', () => {
    const secs = classifyTable(gpu());
    expect(secs.map((s) => s.label)).toEqual(['NVIDIA', 'AMD']);
    expect(secs.map((s) => s.kind)).toEqual(['list', 'list']);
    expect(secs[0].leaves.map((l) => l.label)).toEqual(['H100', 'A100', 'L4']);
    expect(secs[0].leaves[0].inputCellIds).toEqual(['gpu-h100']);
    expect(secs[0].totalInputs).toBe(3);
    expect(secs[1].leaves.map((l) => l.label)).toEqual(['MI300X', 'MI250X']);
  });
});

describe('classifyTable — 종사자 (MATRIX)', () => {
  it('품목별 matrix 섹션 + 시설/직군 열 그룹', () => {
    const secs = classifyTable(workers());
    expect(secs.map((s) => s.label)).toEqual(['① 제재목', '② 합판']);
    expect(secs.every((s) => s.kind === 'matrix')).toBe(true);
    // 열 그룹: 사무직(남/여) · 생산직(남/여)
    expect(secs[0].colGroups.map((g) => g.label)).toEqual(['사무직', '생산직']);
    expect(secs[0].colGroups[0].cols.map((c) => c.label)).toEqual(['남', '여']);
    // 리프 = 연령행, 각 4개 입력
    expect(secs[0].leaves).toHaveLength(3);
    expect(secs[0].leaves[0].label).toBe('29세 이하');
    expect(secs[0].leaves[0].inputCellIds).toHaveLength(4);
    expect(secs[0].totalInputs).toBe(12);
  });
});

describe('classifyTable — 숯 혼합 (MATRIX + SCALAR + SCALAR)', () => {
  it('한 표가 섹션별로 다른 kind', () => {
    const secs = classifyTable(charcoal());
    expect(secs.map((s) => s.label)).toEqual([
      '1) 생산방식별 시설 용량 및 개수',
      '2) 연간 최대 생산 가능량',
      '3) 월평균 가동일 수',
    ]);
    expect(secs.map((s) => s.kind)).toEqual(['matrix', 'scalar', 'scalar']);
    // matrix 섹션: 비대칭 하위 그룹(방식) + 종류 리프
    expect(secs[0].leaves.map((l) => l.label)).toEqual(['흑탄', '백탄', '톱밥숯', '칩', '대나무']);
    expect(secs[0].leaves[0].subGroup).toBe('전통식 가마');
    expect(secs[0].leaves[3].subGroup).toBe('기계식 탄화로');
    expect(secs[0].colGroups.map((g) => g.label)).toEqual(['시설 1', '시설 2']);
    expect(secs[0].leaves[0].inputCellIds).toEqual(['s1-heuk-1c', 's1-heuk-1q', 's1-heuk-2c', 's1-heuk-2q']);
    // scalar 섹션: 입력 1칸이 값 열 전체 colspan
    expect(secs[1].leaves.map((l) => l.label)).toEqual(['숯', '목초액 (죽초액)']);
    expect(secs[1].leaves[0].inputCellIds).toEqual(['s2-charcoal']);
    expect(secs[2].leaves[0].inputCellIds).toEqual(['s3-days']);
  });
});

describe('classifyTable — 평면 단순', () => {
  it('rowspan 없는 라벨1+값1 → 각 행이 scalar 섹션', () => {
    const secs = classifyTable(flatSimple());
    expect(secs).toHaveLength(3);
    expect(secs.every((s) => s.kind === 'scalar')).toBe(true);
    expect(secs.every((s) => s.leaves.length === 1)).toBe(true);
  });
});

describe('decideDrilldown', () => {
  it('GPU(입력 5개): 15 이하 → 기존 카드 유지', () => {
    expect(decideDrilldown(gpu()).useDrilldown).toBe(false);
  });
  it('큰 list(입력 16개): 임계 초과 → 드릴다운', () => {
    expect(decideDrilldown(bigList()).useDrilldown).toBe(true);
  });
  it('종사자: matrix → 드릴다운', () => {
    expect(decideDrilldown(workers()).useDrilldown).toBe(true);
  });
  it('숯: matrix + 다중 라벨열 → 드릴다운', () => {
    expect(decideDrilldown(charcoal()).useDrilldown).toBe(true);
  });
  it('평면 단순(라벨1열·단일행 섹션·비매트릭스) → 스테퍼 유지', () => {
    const d = decideDrilldown(flatSimple());
    expect(d.labelColCount).toBe(1);
    expect(d.useDrilldown).toBe(false);
  });
});
