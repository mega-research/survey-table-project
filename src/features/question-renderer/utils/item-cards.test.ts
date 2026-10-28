import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import { buildItemCards, itemCardTitleText } from './item-cards';

function text(id: string, content: string, overrides: Partial<TableCell> = {}): TableCell {
  return { id, type: 'text', content, ...overrides };
}

function input(id: string, overrides: Partial<TableCell> = {}): TableCell {
  return { id, type: 'input', content: '', ...overrides };
}

const summarize = (rows: TableRow[]) =>
  buildItemCards(rows).map((card) => ({
    row: card.rowId,
    title: card.titleCells.map(itemCardTitleText).join(' > ') || `(${card.fallbackTitle})`,
    inputs: card.inputs.map((entry) => entry.cell.id),
    display: card.displayCells.map((cell) => cell.id),
  }));

describe('buildItemCards', () => {
  it('한 행의 라벨 + 입력 쌍마다 카드를 나눈다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: '기업명/대표자 성별',
        cells: [
          text('l1', '(1) 기업명'),
          input('name', { colspan: 2 }),
          input('name-covered', { isHidden: true }),
          text('l2', '(2) 대표자 성별'),
          { id: 'sex', type: 'radio', content: '', radioOptions: [
            { id: 'm', label: '남', value: 'm' },
            { id: 'f', label: '여', value: 'f' },
          ] },
        ],
      },
    ];
    expect(summarize(rows)).toEqual([
      { row: 'r1', title: '(1) 기업명', inputs: ['name'], display: [] },
      { row: 'r1', title: '(2) 대표자 성별', inputs: ['sex'], display: [] },
    ]);
  });

  it('세로 병합된 입력 칸은 시작 행 카드에만 두고, 병합된 상위 라벨은 아래 행 카드 제목에 따라간다', () => {
    const rows: TableRow[] = [
      {
        id: 'r2',
        label: '설립연도/기획_개발_시점',
        cells: [
          text('found', '(3) 설립연도', { rowspan: 2 }),
          input('found-y', { rowspan: 2 }),
          input('found-m', { rowspan: 2 }),
          text('ai', '(4) 인공지능 시작연도', { rowspan: 2 }),
          text('plan', '(4-1) 기획/개발 시점'),
          input('plan-y'),
          input('plan-m'),
        ],
      },
      {
        id: 'r3',
        label: '출시_서비스_시점',
        cells: [
          text('found-c', '(3) 설립연도', { isHidden: true }),
          input('found-y-c', { isHidden: true }),
          input('found-m-c', { isHidden: true }),
          text('ai-c', '(4) 인공지능 시작연도', { isHidden: true }),
          text('launch', '(4-2) 출시/서비스 시점'),
          input('launch-y'),
          input('launch-m'),
        ],
      },
    ];
    expect(summarize(rows)).toEqual([
      { row: 'r2', title: '(3) 설립연도', inputs: ['found-y', 'found-m'], display: [] },
      {
        row: 'r2',
        title: '(4) 인공지능 시작연도 > (4-1) 기획/개발 시점',
        inputs: ['plan-y', 'plan-m'],
        display: [],
      },
      {
        row: 'r3',
        title: '(4) 인공지능 시작연도 > (4-2) 출시/서비스 시점',
        inputs: ['launch-y', 'launch-m'],
        display: [],
      },
    ]);
  });

  it('구분 열이 세로 병합된 표는 행마다 구분 > 항목 제목의 카드가 된다', () => {
    const rows: TableRow[] = [
      { id: 'a', label: 'a', cells: [text('sec', '직접 참여', { rowspan: 2 }), text('i1', '① 지원'), input('v1')] },
      { id: 'b', label: 'b', cells: [text('sec-c', '', { isHidden: true }), text('i2', '② 개발'), input('v2')] },
    ];
    expect(summarize(rows).map((card) => card.title)).toEqual([
      '직접 참여 > ① 지원',
      '직접 참여 > ② 개발',
    ]);
  });

  it('모바일 표시가 숨김인 글자는 버리고, 바로 표시·접기는 카드 설명으로 붙인다', () => {
    const rows: TableRow[] = [
      {
        id: 'r',
        label: '행',
        cells: [
          text('label', '매출액'),
          text('before', '부가세 제외', { mobileDisplay: 'inline' }),
          input('amount'),
          text('unit', '백만원', { mobileDisplay: 'hidden' }),
          text('note', '※ 추정치 가능', { mobileDisplay: 'collapsed' }),
          text('next', '종사자 수'),
          input('workers'),
        ],
      },
    ];
    expect(summarize(rows)).toEqual([
      { row: 'r', title: '매출액', inputs: ['amount'], display: ['before', 'note'] },
      { row: 'r', title: '종사자 수', inputs: ['workers'], display: [] },
    ]);
  });

  it('라벨이 없는 행은 행 이름을 제목으로 쓰고, 입력 칸이 없는 행은 카드가 되지 않는다', () => {
    const rows: TableRow[] = [
      { id: 'head', label: '머리', cells: [text('h', '안내 문구', { colspan: 2 }), text('h2', '', { isHidden: true })] },
      { id: 'plain', label: '행 이름', cells: [text('blank', ''), input('only')] },
    ];
    expect(summarize(rows)).toEqual([
      { row: 'plain', title: '(행 이름)', inputs: ['only'], display: [] },
    ]);
  });

  it('라벨 뒤에 바로 표시 글자만 오고 입력 칸 없이 다음 라벨·행 끝이 오면 그 라벨의 표시 전용 카드가 된다', () => {
    // 전시회 정보(라벨 | 값 | 라벨 | 값)와 응답자 정보(업체명 | 값 | 휴대전화 | 입력)
    const rows: TableRow[] = [
      {
        id: 'expo',
        label: '',
        cells: [
          text('name', '전시회명'),
          text('name-v', '{{전시회명}}', { mobileDisplay: 'inline' }),
          text('period', '개최 기간'),
          text('period-v', '{{개최기간}}', { mobileDisplay: 'inline' }),
        ],
      },
      {
        id: 'info',
        label: '',
        cells: [
          text('company', '업체명'),
          text('company-v', '{{업체명}}', { mobileDisplay: 'inline' }),
          text('mobile', '휴대전화'),
          input('mobile-in'),
        ],
      },
    ];
    const cards = buildItemCards(rows);
    expect(summarize(rows)).toEqual([
      { row: 'expo', title: '전시회명', inputs: [], display: ['name-v'] },
      { row: 'expo', title: '개최 기간', inputs: [], display: ['period-v'] },
      { row: 'info', title: '업체명', inputs: [], display: ['company-v'] },
      { row: 'info', title: '휴대전화', inputs: ['mobile-in'], display: [] },
    ]);
    expect(new Set(cards.map((card) => card.key)).size).toBe(cards.length);
  });

  it('세로 병합된 구분 라벨 뒤의 바로 표시 글자는 하위 항목 카드의 설명이 된다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: '',
        cells: [
          text('group', '바이어 접촉 명수', { rowspan: 2 }),
          text('desc', '명함을 수집한 참관객 수', { rowspan: 2, mobileDisplay: 'inline' }),
          text('old', '기존'),
          input('old-in'),
        ],
      },
      {
        id: 'r2',
        label: '',
        cells: [
          text('group-c', '', { isHidden: true }),
          text('desc-c', '', { isHidden: true }),
          text('new', '신규'),
          input('new-in'),
        ],
      },
    ];
    expect(summarize(rows)).toEqual([
      { row: 'r1', title: '바이어 접촉 명수 > 기존', inputs: ['old-in'], display: ['desc'] },
      { row: 'r2', title: '바이어 접촉 명수 > 신규', inputs: ['new-in'], display: [] },
    ]);
  });

  it('라벨 없이 앞선 바로 표시 글자는 종전대로 다음 카드의 설명이다', () => {
    const rows: TableRow[] = [
      {
        id: 'r',
        label: '행 이름',
        cells: [text('note', '※ 원 단위', { mobileDisplay: 'inline' }), input('v')],
      },
    ];
    expect(summarize(rows)).toEqual([{ row: 'r', title: '(행 이름)', inputs: ['v'], display: ['note'] }]);
  });

  it('옵션 1개짜리 라디오는 입력이 아니라 라벨이다', () => {
    const rows: TableRow[] = [
      {
        id: 'r',
        label: '행',
        cells: [
          { id: 'tag', type: 'radio', content: '', radioOptions: [{ id: 'o', label: '① 항목', value: 'o' }] },
          input('v'),
        ],
      },
    ];
    expect(summarize(rows)).toEqual([{ row: 'r', title: '① 항목', inputs: ['v'], display: [] }]);
  });
});
