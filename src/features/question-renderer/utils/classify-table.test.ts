import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyTable,
  decideDrilldown,
  type ClassifyInput,
} from '@/features/question-renderer/utils/classify-table';
import type { TableCell, TableColumn, TableRow, HeaderCell } from '@/types/survey';

// ── 셀/열/헤더 빌더 (디자인 핸드오프와 동일 의미) ──
let _id = 0;
const cid = () => 'c' + ++_id;
const T = (content: string, o: { rs?: number; cs?: number } = {}): TableCell => ({
  id: cid(),
  type: 'text',
  content,
  ...(o.rs !== undefined ? { rowspan: o.rs } : {}),
  ...(o.cs !== undefined ? { colspan: o.cs } : {}),
});
const H = (): TableCell => ({ id: cid(), type: 'text', content: '', isHidden: true });
const I = (id: string, o: { cs?: number; ph?: string } = {}): TableCell => ({
  id,
  type: 'input',
  inputType: 'number',
  content: '',
  ...(o.cs !== undefined ? { colspan: o.cs } : {}),
  placeholder: o.ph ?? 'ex) 100',
});
const S = (id: string): TableCell => ({ id, type: 'select', content: '' });
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

// ── 표 6: 수출 국가 및 비중 (라벨 1열 rowspan 병합 + 행마다 row.label "_n") ──
// 라벨 셀이 rowspan 으로 병합돼 있어 첫 행 셀 content 는 그룹 전체 라벨(풀 텍스트)이고,
// 나머지 행은 가려진(isHidden) 연속 셀이다. 개별 행 식별은 row.label "_1"~"_n" 에만 있다.
function exportCountry(n = 3): ClassifyInput {
  const cols = [C('구분'), C('국가코드'), C('비중'), C('국가코드'), C('비중')];
  const rows: TableRow[] = Array.from({ length: n }, (_, i) => ({
    id: `ec${i}`,
    label: `수출 국가 및 비중(%)_${i + 1}`,
    cells: [
      i === 0 ? T('수출 국가 및 비중(%) (국가 코드 참조)', { rs: n }) : H(),
      S(`ec${i}-c1`),
      I(`ec${i}-v1`),
      S(`ec${i}-c2`),
      I(`ec${i}-v2`),
    ],
  }));
  return { tableColumns: cols, tableRowsData: rows };
}

// ── 표 7: 비대칭 matrix (값 열 2개, 행마다 채우는 열이 다름) ──
// 품목 ▸ 연령(남/여). 일부 연령행은 남만, 일부는 여만 입력 가능(반대편은 빈 라벨 셀).
// 드릴다운 matrix 폼은 colGroups(열 합집합) 순서에 inputCellIds 를 위치로 끼워 맞추는데,
// 행마다 입력 칸 수가 다르면 그 가정이 깨진다 → 셀이 엉뚱한 열에 붙거나 누락된다.
function asymMatrix(): ClassifyInput {
  const cols = [C('품목'), C('연령'), C('남'), C('여')];
  const grid: HeaderCell[][] = [
    [HC('구분', 2, 2), HC('직군', 2)],
    [HC('남'), HC('여')],
  ];
  const rows: TableRow[] = [
    // 전체: 남+여 둘 다
    { id: 'a', label: '', cells: [T('제재목', { rs: 3 }), T('전체'), I('a-m'), I('a-f')] },
    // 남자전용: 남만 입력, 여 자리는 빈 라벨(text)
    { id: 'b', label: '', cells: [H(), T('남자전용'), I('b-m'), T('')] },
    // 여자전용: 여만 입력, 남 자리는 빈 라벨(text) → inputCellIds=["c-f"] 한 개
    { id: 'c', label: '', cells: [H(), T('여자전용'), T(''), I('c-f')] },
  ];
  return { tableColumns: cols, tableRowsData: rows, tableHeaderGrid: grid };
}

beforeEach(() => {
  _id = 0;
});

describe('classifyTable — GPU (LIST)', () => {
  it('제조사 rowspan 블록이 섹션, 각 섹션은 list', () => {
    const secs = classifyTable(gpu());
    expect(secs.map((s) => s.label)).toEqual(['NVIDIA', 'AMD']);
    expect(secs.map((s) => s.kind)).toEqual(['list', 'list']);
    const sec0 = secs[0];
    const sec1 = secs[1];
    if (!sec0) throw new Error('secs[0] undefined');
    if (!sec1) throw new Error('secs[1] undefined');
    expect(sec0.leaves.map((l) => l.label)).toEqual(['H100', 'A100', 'L4']);
    const leaf0 = sec0.leaves[0];
    if (!leaf0) throw new Error('sec0.leaves[0] undefined');
    expect(leaf0.inputCellIds).toEqual(['gpu-h100']);
    expect(sec0.totalInputs).toBe(3);
    expect(sec1.leaves.map((l) => l.label)).toEqual(['MI300X', 'MI250X']);
  });
});

describe('classifyTable — 종사자 (MATRIX)', () => {
  it('품목별 matrix 섹션 + 시설/직군 열 그룹', () => {
    const secs = classifyTable(workers());
    expect(secs.map((s) => s.label)).toEqual(['① 제재목', '② 합판']);
    expect(secs.every((s) => s.kind === 'matrix')).toBe(true);
    const sec0 = secs[0];
    if (!sec0) throw new Error('secs[0] undefined');
    // 열 그룹: 사무직(남/여) · 생산직(남/여)
    expect(sec0.colGroups.map((g) => g.label)).toEqual(['사무직', '생산직']);
    const colGroup0 = sec0.colGroups[0];
    if (!colGroup0) throw new Error('sec0.colGroups[0] undefined');
    expect(colGroup0.cols.map((c) => c.label)).toEqual(['남', '여']);
    // 리프 = 연령행, 각 4개 입력
    expect(sec0.leaves).toHaveLength(3);
    const leaf0 = sec0.leaves[0];
    if (!leaf0) throw new Error('sec0.leaves[0] undefined');
    expect(leaf0.label).toBe('29세 이하');
    expect(leaf0.inputCellIds).toHaveLength(4);
    expect(sec0.totalInputs).toBe(12);
  });
});

describe('classifyTable — 숯 혼합 (MATRIX + SCALAR + SCALAR)', () => {
  it('한 표가 섹션별로 다른 kind', () => {
    const input = charcoal();
    const secs = classifyTable(input);
    expect(secs.map((s) => s.label)).toEqual([
      '1) 생산방식별 시설 용량 및 개수',
      '2) 연간 최대 생산 가능량',
      '3) 월평균 가동일 수',
    ]);
    expect(secs.map((s) => s.kind)).toEqual(['matrix', 'scalar', 'scalar']);
    const sec0 = secs[0];
    const sec1 = secs[1];
    const sec2 = secs[2];
    if (!sec0) throw new Error('secs[0] undefined');
    if (!sec1) throw new Error('secs[1] undefined');
    if (!sec2) throw new Error('secs[2] undefined');
    // matrix 섹션: 비대칭 하위 그룹(방식) + 종류 리프
    expect(sec0.leaves.map((l) => l.label)).toEqual(['흑탄', '백탄', '톱밥숯', '칩', '대나무']);
    const leaf0 = sec0.leaves[0];
    const leaf3 = sec0.leaves[3];
    if (!leaf0) throw new Error('sec0.leaves[0] undefined');
    if (!leaf3) throw new Error('sec0.leaves[3] undefined');
    expect(leaf0.subGroup).toBe('전통식 가마');
    expect(leaf3.subGroup).toBe('기계식 탄화로');
    const traditionalAnchorId = input.tableRowsData[0]?.cells[1]?.id;
    const machineAnchorId = input.tableRowsData[3]?.cells[1]?.id;
    expect(sec0.leaves.slice(0, 3).map((leaf) => leaf.subGroupSourceCellId)).toEqual([
      traditionalAnchorId,
      traditionalAnchorId,
      traditionalAnchorId,
    ]);
    expect(sec0.leaves.slice(3).map((leaf) => leaf.subGroupSourceCellId)).toEqual([
      machineAnchorId,
      machineAnchorId,
    ]);
    expect(sec0.colGroups.map((g) => g.label)).toEqual(['시설 1', '시설 2']);
    expect(leaf0.inputCellIds).toEqual(['s1-heuk-1c', 's1-heuk-1q', 's1-heuk-2c', 's1-heuk-2q']);
    // scalar 섹션: 입력 1칸이 값 열 전체 colspan
    expect(sec1.leaves.map((l) => l.label)).toEqual(['숯', '목초액 (죽초액)']);
    const sec1leaf0 = sec1.leaves[0];
    const sec2leaf0 = sec2.leaves[0];
    if (!sec1leaf0) throw new Error('sec1.leaves[0] undefined');
    if (!sec2leaf0) throw new Error('sec2.leaves[0] undefined');
    expect(sec1leaf0.inputCellIds).toEqual(['s2-charcoal']);
    expect(sec2leaf0.inputCellIds).toEqual(['s3-days']);
  });
});

describe('classifyTable — 비대칭 matrix (행마다 입력 열 다름)', () => {
  it('각 입력 셀은 실제 열 인덱스(cellByCol)로 매핑돼 위치 밀림이 없다', () => {
    const secs = classifyTable(asymMatrix());
    const sec0 = secs[0];
    if (!sec0) throw new Error('secs[0] undefined');
    expect(sec0.kind).toBe('matrix');
    // 값 열은 col 2(남) · col 3(여)
    const cols = sec0.colGroups.flatMap((g) => g.cols.map((c) => c.col));
    expect(cols).toEqual([2, 3]);

    const [whole, maleOnly, femaleOnly] = sec0.leaves;
    if (!whole || !maleOnly || !femaleOnly) throw new Error('leaves missing');

    // 전체 행: 남 셀 col2 = a-m, 여 셀 col3 = a-f
    expect(whole.cellByCol[2]).toBe('a-m');
    expect(whole.cellByCol[3]).toBe('a-f');

    // 남자전용: 남(col2)만 채움. 여(col3) 자리는 비어 있어야 한다(undefined).
    expect(maleOnly.cellByCol[2]).toBe('b-m');
    expect(maleOnly.cellByCol[3]).toBeUndefined();

    // 여자전용: 여(col3)만 채움. 남(col2) 자리는 비어 있어야 한다.
    // 위치 끼워맞춤이면 c-f 가 col2(남)에 잘못 붙는 버그가 여기서 잡힌다.
    expect(femaleOnly.cellByCol[2]).toBeUndefined();
    expect(femaleOnly.cellByCol[3]).toBe('c-f');
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

describe('classifyTable — 수출 국가 (라벨 rowspan 병합)', () => {
  it('rowspan 병합 라벨 셀의 첫 행도 row.label 기반으로 일관되게 매겨진다', () => {
    const secs = classifyTable(exportCountry(3));
    expect(secs).toHaveLength(1);
    const sec0 = secs[0];
    if (!sec0) throw new Error('secs[0] undefined');
    expect(sec0.kind).toBe('matrix');
    // 첫 리프가 병합 셀의 풀 텍스트가 아니라 row.label "_1" 이어야 한다.
    expect(sec0.leaves.map((l) => l.label)).toEqual([
      '수출 국가 및 비중(%)_1',
      '수출 국가 및 비중(%)_2',
      '수출 국가 및 비중(%)_3',
    ]);
  });
});

describe('classifyTable — 주입된 answerable 셀 타입', () => {
  it('choice_opt를 주입한 경우 기존 rowspan section과 원본 행 leaf를 만든다', () => {
    const input: ClassifyInput = {
      tableColumns: [C('대분류'), C('항목'), C('선택')],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            T('유저 지표', { rs: 2 }),
            T('활성 사용자'),
            { id: 'o1', type: 'choice_opt', content: '' },
          ],
        },
        {
          id: 'r2',
          label: '',
          cells: [H(), T('재방문율'), { id: 'o2', type: 'choice_opt', content: '' }],
        },
      ],
      answerableCellTypes: ['choice_opt'],
    };

    const sections = classifyTable(input);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe('유저 지표');
    expect(sections[0]?.leaves.map((leaf) => leaf.rowId)).toEqual(['r1', 'r2']);
  });

  it('section·leaf·subgroup 라벨 provenance를 rowspan anchor identity로 보존한다', () => {
    const sections = classifyTable({
      tableColumns: [C('섹션'), C('하위 그룹'), C('항목'), C('응답')],
      tableRowsData: [
        {
          id: 'provenance-r1',
          label: '첫 항목',
          cells: [
            { id: 'section-anchor', type: 'text', content: '섹션', rowspan: 2 },
            { id: 'subgroup-anchor', type: 'image', content: '하위 그룹', rowspan: 2 },
            { id: 'leaf-source-1', type: 'text', content: '첫 항목' },
            I('provenance-input-1'),
          ],
        },
        {
          id: 'provenance-r2',
          label: '둘째 항목',
          cells: [
            {
              id: 'section-continuation',
              type: 'text',
              content: '',
              isHidden: true,
              _isContinuation: true,
            },
            {
              id: 'subgroup-continuation',
              type: 'image',
              content: '',
              isHidden: true,
              _isContinuation: true,
            },
            { id: 'leaf-source-2', type: 'video', content: '둘째 항목' },
            I('provenance-input-2'),
          ],
        },
      ],
    });

    expect(sections[0]).toMatchObject({ labelSourceCellId: 'section-anchor' });
    expect(sections[0]?.leaves).toMatchObject([
      {
        labelSourceCellId: 'leaf-source-1',
        subGroupSourceCellId: 'subgroup-anchor',
      },
      {
        labelSourceCellId: 'leaf-source-2',
        subGroupSourceCellId: 'subgroup-anchor',
      },
    ]);
  });
});

describe('계산 셀 leaf', () => {
  const CALC = (id: string): TableCell => ({
    id,
    type: 'calc',
    content: '',
    formula: { kind: 'cell', cellId: 'sum-src' },
  });

  const sumTable = (): ClassifyInput => ({
    tableColumns: [C('항목'), C('금액')],
    tableRowsData: [
      { id: 'r1', label: '', cells: [T('항목 A'), I('amt-a')] },
      { id: 'r2', label: '', cells: [T('항목 B'), I('amt-b')] },
      { id: 'r3', label: '', cells: [T('합계'), CALC('total')] },
    ],
  });

  it('includeCalcOnlyLeaves 옵션이 켜지면 계산 셀만 있는 행도 leaf 가 된다', () => {
    const sections = classifyTable({ ...sumTable(), includeCalcOnlyLeaves: true });
    const leaves = sections.flatMap((s) => s.leaves);
    const totalLeaf = leaves.find((l) => l.calcCellIds.includes('total'));
    expect(totalLeaf).toBeDefined();
    expect(totalLeaf!.inputCellIds).toEqual([]);
    // 완료 카운트(totalInputs)에는 calc 가 섞이지 않는다
    expect(sections.reduce((s, sec) => s + sec.totalInputs, 0)).toBe(2);
  });

  it('옵션 미지정(행 선택 UI 등 기존 소비처)이면 계산 전용 행은 leaf 가 되지 않는다', () => {
    const leaves = classifyTable(sumTable()).flatMap((s) => s.leaves);
    expect(leaves.some((l) => l.calcCellIds.includes('total'))).toBe(false);
    expect(leaves).toHaveLength(2);
  });

  it('입력 행의 calc 셀은 같은 leaf 의 calcCellIds 로 분리된다', () => {
    const q: ClassifyInput = {
      tableColumns: [C('항목'), C('수량'), C('금액')],
      tableRowsData: [
        { id: 'r1', label: '', cells: [T('항목 A'), I('qty-a'), CALC('amt-calc')] },
      ],
    };
    const leaves = classifyTable(q).flatMap((s) => s.leaves);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.inputCellIds).toEqual(['qty-a']);
    expect(leaves[0]!.calcCellIds).toEqual(['amt-calc']);
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

// ── 묶음 머리 · 설명 셀 (readMobileDisplay) ──
describe('classifyTable — 들여쓰기 표시 셀 · 묶음 머리 · 설명 셀', () => {
  const CALC = (id: string): TableCell => ({
    id,
    type: 'calc',
    content: '',
    formula: { kind: 'cell', cellId: 'x' },
  });
  const TX = (id: string, content: string, o: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'text',
    content,
    ...o,
  });
  const cols = () => [C('직업 분류'), C('직업 분류'), C('설명'), C('상용'), C('임시'), C('합계')];
  // 맨 윗줄 행: 제목이 좁은 칸 + 라벨 칸을 가로 병합
  const topRow = (key: string, title: string, o: { calcOnly?: boolean; desc?: Partial<TableCell> } = {}): TableRow => ({
    id: key,
    label: '',
    cells: [
      TX(`${key}-title`, title, { colspan: 2 }),
      H(),
      TX(`${key}-desc`, `${title} 설명\n둘째 줄`, o.desc),
      o.calcOnly ? CALC(`${key}-a`) : I(`${key}-a`),
      o.calcOnly ? CALC(`${key}-b`) : I(`${key}-b`),
      CALC(`${key}-sum`),
    ],
  });
  const childRow = (key: string, title: string, first: TableCell): TableRow => ({
    id: key,
    label: '',
    cells: [
      first,
      TX(`${key}-title`, title),
      TX(`${key}-desc`, `${title} 설명`, { mobileDisplay: 'collapsed' }),
      I(`${key}-a`),
      I(`${key}-b`),
      CALC(`${key}-sum`),
    ],
  });
  const marker = (o: Partial<TableCell> = {}): TableCell =>
    TX('marker', '', { rowspan: 3, mobileDisplay: 'hidden', ...o });
  const jobs = (o: { marker?: TableCell; r3?: TableRow } = {}): TableRow[] => [
    topRow('r1', '1. 관리자', { desc: { mobileDisplay: 'collapsed' } }),
    o.r3 ?? topRow('r3', '3. 개발자', { calcOnly: true, desc: { mobileDisplay: 'inline' } }),
    childRow('r31', '3-1. 설계', o.marker ?? marker()),
    childRow('r32', '3-2. SW', H()),
    childRow('r33', '3-3. HW', H()),
    topRow('rt', '합계', { calcOnly: true }),
  ];
  const run = (rows: TableRow[], authoredRows: TableRow[] = rows) =>
    classifyTable({
      tableColumns: cols(),
      tableRowsData: rows,
      authoredRows,
      includeCalcOnlyLeaves: true,
      readMobileDisplay: true,
    });
  const brief = (rows: TableRow[], authoredRows?: TableRow[]) =>
    run(rows, authoredRows).map((s) => [s.label, s.role, s.groupHeadRowId ?? null]);

  it('빈 숨김 셀이 덮는 행은 각자 섹션이 되고 윗행(계산 전용)이 묶음 머리가 된다', () => {
    expect(brief(jobs())).toEqual([
      ['1. 관리자', 'default', null],
      ['3. 개발자', 'group-head', 'r3'],
      ['3-1. 설계', 'default', 'r3'],
      ['3-2. SW', 'default', 'r3'],
      ['3-3. HW', 'default', 'r3'],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('쪼갠 섹션은 식별자가 서로 다르고 리프를 하나씩 갖는다', () => {
    const children = run(jobs()).filter((s) => s.groupHeadRowId === 'r3' && s.role === 'default');
    expect(new Set(children.map((s) => s.identity)).size).toBe(3);
    expect(children.map((s) => s.leaves.map((l) => l.rowId))).toEqual([['r31'], ['r32'], ['r33']]);
    expect(children.map((s) => s.totalInputs)).toEqual([2, 2, 2]);
  });

  it('설명 셀은 제목 후보에서 빠지고 리프의 설명으로 실린다', () => {
    const sections = run(jobs());
    const leaf = sections[0]!.leaves[0]!;
    expect(leaf.label).toBe('1. 관리자');
    expect(leaf.descriptionCellIds).toEqual(['r1-desc']);
    expect(sections[2]!.leaves[0]!.label).toBe('3-1. 설계');
    expect(sections[2]!.leaves[0]!.descriptionCellIds).toEqual(['r31-desc']);
  });

  it('모바일 표시를 지정하지 않은 글자 셀은 설명이 아니다 — 기존처럼 가장 오른쪽 글자가 제목', () => {
    const leaf = run(jobs()).at(-1)!.leaves[0]!;
    expect(leaf.descriptionCellIds).toEqual([]);
    expect(leaf.label).toBe('합계 설명\n둘째 줄');
  });

  it('세로 병합된 설명 셀은 덮인 행 모두의 설명이다', () => {
    const rows = jobs();
    rows[2]!.cells[2] = TX('shared-desc', '공통 설명', { rowspan: 2, mobileDisplay: 'inline' });
    rows[3]!.cells[2] = H();
    const sections = run(rows);
    expect(sections[2]!.leaves[0]!.descriptionCellIds).toEqual(['shared-desc']);
    expect(sections[3]!.leaves[0]!.descriptionCellIds).toEqual(['shared-desc']);
    expect(sections[3]!.leaves[0]!.label).toBe('3-2. SW');
  });

  it('모바일 표시를 지정한 적 없는 빈 병합 셀도 들여쓰기 표시다 — 글자 셀의 기본값이 숨기기', () => {
    expect(brief(jobs({ marker: TX('marker', '', { rowspan: 3 }) })).map(([label]) => label)).toEqual([
      '1. 관리자', '3. 개발자', '3-1. 설계', '3-2. SW', '3-3. HW', '합계',
    ]);
  });

  it('빈 병합 셀에 숨기기가 아닌 표시를 걸면 지금처럼 한 섹션으로 뭉친다', () => {
    expect(brief(jobs({ marker: marker({ mobileDisplay: 'header' }) }))).toEqual([
      ['1. 관리자', 'default', null],
      ['3. 개발자', 'calc-summary', null],
      ['', 'default', null],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('하위에 입력 행이 없으면(계산 행 아래의 계산 행) 묶음이 아니다', () => {
    const rows: TableRow[] = [
      topRow('r1', '1. 관리자'),
      topRow('rs', '소계', { calcOnly: true }),
      {
        id: 'rt',
        label: '',
        cells: [TX('blank', ''), TX('rt-title', '합계'), TX('rt-desc', ''), CALC('rt-a'), CALC('rt-b'), CALC('rt-sum')],
      },
    ];
    expect(brief(rows)).toEqual([
      ['1. 관리자', 'default', null],
      ['소계', 'calc-summary', null],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('내용이 있는 병합 셀은 숨기기를 걸어도 쪼개지 않는다', () => {
    const out = brief(jobs({ marker: marker({ content: '하위' }) }));
    expect(out).toHaveLength(4);
    expect(out[2]).toEqual(['하위', 'default', null]);
  });

  it('윗행에 입력칸이 있으면 묶음 없이 평평하다', () => {
    expect(brief(jobs({ r3: topRow('r3', '3. 개발자') }))).toEqual([
      ['1. 관리자', 'default', null],
      ['3. 개발자', 'default', null],
      ['3-1. 설계', 'default', null],
      ['3-2. SW', 'default', null],
      ['3-3. HW', 'default', null],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('들여쓰기 표시 셀이 표 맨 위면 묶음 없이 평평하다', () => {
    const rows = jobs().slice(2);
    expect(brief(rows).slice(0, 3)).toEqual([
      ['3-1. 설계', 'default', null],
      ['3-2. SW', 'default', null],
      ['3-3. HW', 'default', null],
    ]);
  });

  it('윗행이 다른 세로 병합 묶음의 일부면 머리가 되지 않는다', () => {
    const rows = jobs();
    rows[0]!.cells[0] = TX('merged', '위 묶음', { rowspan: 2 });
    rows[1]!.cells[0] = H();
    const out = brief(rows);
    expect(out.every(([, role]) => role !== 'group-head')).toBe(true);
    expect(out.slice(1, 4).map(([label]) => label)).toEqual(['3-1. 설계', '3-2. SW', '3-3. HW']);
  });

  it('하위가 일부만 보이면 남은 하위만 머리에 소속된다', () => {
    const authored = jobs();
    // 3-1 이 표시조건으로 빠지면 병합 시작 셀이 다음 가시 행으로 올라온다(id 유지)
    const visible = [authored[0]!, authored[1]!, childRow('r32', '3-2. SW', marker({ rowspan: 2 })), authored[4]!, authored[5]!];
    expect(brief(visible, authored)).toEqual([
      ['1. 관리자', 'default', null],
      ['3. 개발자', 'group-head', 'r3'],
      ['3-2. SW', 'default', 'r3'],
      ['3-3. HW', 'default', 'r3'],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('하위가 전부 숨겨지면 머리도 빠진다', () => {
    const authored = jobs();
    const visible = [authored[0]!, authored[1]!, authored[5]!];
    expect(brief(visible, authored)).toEqual([
      ['1. 관리자', 'default', null],
      ['합계', 'calc-summary', null],
    ]);
  });

  it('들여쓰기 표시 셀이 두 군데면 묶음도 둘이다', () => {
    const rows = [
      ...jobs().slice(0, 5),
      topRow('r5', '5. 분석', { calcOnly: true }),
      childRow('r51', '5-1. 통계', TX('marker2', '', { rowspan: 2, mobileDisplay: 'hidden' })),
      childRow('r52', '5-2. 시각화', H()),
    ];
    const out = brief(rows);
    expect(out.filter(([, role]) => role === 'group-head').map(([, , head]) => head)).toEqual(['r3', 'r5']);
    expect(out.slice(-2)).toEqual([
      ['5-1. 통계', 'default', 'r5'],
      ['5-2. 시각화', 'default', 'r5'],
    ]);
  });

  it('목차 열이 아닌 열의 빈 글자 셀은 묶음과 무관하다 — 윗행(계산 전용)이 사라지지 않는다', () => {
    const rows = [
      topRow('r1', '1. 관리자'),
      topRow('rt', '소계', { calcOnly: true }),
      topRow('r2', '2. 컨설턴트'),
    ];
    rows[2]!.cells[2] = TX('blank-desc', '', { mobileDisplay: 'hidden' });
    expect(brief(rows).map(([label, role]) => [label, role])).toEqual([
      ['1. 관리자', 'default'],
      ['소계', 'calc-summary'],
      ['2. 컨설턴트', 'default'],
    ]);
  });

  it('조건부로 숨은 열이 있어도 저작 행의 목차 열을 열 id 로 찾는다', () => {
    const visibleCols = cols();
    const authoredCols = [C('숨은 열'), ...visibleCols];
    const authored = jobs().map((row) => ({ ...row, cells: [TX(`${row.id}-x`, 'x'), ...row.cells] }));
    const sections = classifyTable({
      tableColumns: visibleCols,
      tableRowsData: jobs(),
      authoredRows: authored,
      authoredColumns: authoredCols,
      includeCalcOnlyLeaves: true,
      readMobileDisplay: true,
    });
    expect(sections.map((s) => s.role)).toEqual([
      'default', 'group-head', 'default', 'default', 'default', 'calc-summary',
    ]);
  });

  it('하위 행 안에 또 다른 라벨 병합이 있어도 행마다 섹션이 되고 제목은 가장 오른쪽 라벨이다', () => {
    const wide = [C('들여쓰기'), C('중분류'), C('소분류'), C('상용'), C('임시')];
    const rows: TableRow[] = [
      { id: 'h', label: '', cells: [TX('h-t', '3. 개발자', { colspan: 3 }), H(), H(), CALC('h-a'), CALC('h-b')] },
      { id: 'a', label: '', cells: [TX('m', '', { rowspan: 2 }), TX('mid', 'SW', { rowspan: 2 }), TX('a-t', '백엔드'), I('a-a'), I('a-b')] },
      { id: 'b', label: '', cells: [H(), H(), TX('b-t', '프런트'), I('b-a'), I('b-b')] },
    ];
    const sections = classifyTable({
      tableColumns: wide,
      tableRowsData: rows,
      includeCalcOnlyLeaves: true,
      readMobileDisplay: true,
    });
    expect(sections.map((s) => [s.label, s.role, s.groupHeadRowId])).toEqual([
      ['3. 개발자', 'group-head', 'h'],
      ['백엔드', 'default', 'h'],
      ['프런트', 'default', 'h'],
    ]);
    expect(sections[1]!.leaves[0]!.subGroup).toBe('SW');
  });

  it('동적 행 앵커가 병합을 갈라 뒤 세그먼트가 자리 채움 셀로 시작해도 같은 머리에 소속된다', () => {
    const authored = jobs();
    // 뒤 세그먼트: r33 의 자리 채움 셀(id 유지)이 병합 시작 셀로 승격된 모양
    const placeholderId = authored[4]!.cells[0]!.id;
    const visible = [
      authored[0]!,
      authored[1]!,
      childRow('r31', '3-1. 설계', marker({ rowspan: 1 })),
      childRow('r33', '3-3. HW', TX(placeholderId, '', { mobileDisplay: 'hidden' })),
      authored[5]!,
    ];
    expect(brief(visible, authored).slice(1, 4)).toEqual([
      ['3. 개발자', 'group-head', 'r3'],
      ['3-1. 설계', 'default', 'r3'],
      ['3-3. HW', 'default', 'r3'],
    ]);
  });

  it('옵션을 켜지 않으면(보기 소스 표 드릴다운 등) 결과가 종전과 같다', () => {
    const sections = classifyTable({ tableColumns: cols(), tableRowsData: jobs(), includeCalcOnlyLeaves: true });
    expect(sections.map((s) => s.label)).toEqual(['1. 관리자', '3. 개발자', '', '합계']);
    expect(sections.every((s) => s.role === 'default' && s.groupHeadRowId === undefined)).toBe(true);
    expect(sections[0]!.leaves[0]!.label).toBe('1. 관리자 설명\n둘째 줄');
  });
});
