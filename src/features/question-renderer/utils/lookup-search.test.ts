import { describe, expect, it } from 'vitest';

import type { SurveyLookup, TableCell } from '@/types/survey';

import {
  buildLookupPickPatch,
  normalizeLookupSearchText,
  resolveLookupSearch,
  searchLookupRows,
} from './lookup-search';

const companies: SurveyLookup = {
  id: 'lut-1',
  name: '조사명부',
  columns: ['PID', '기업명', '법인등록번호', '사업자등록번호'],
  rows: [
    { PID: '915', 기업명: '삼성전자', 법인등록번호: '130111-0006246', 사업자등록번호: '1248100998' },
    { PID: '1486', 기업명: '에스케이하이닉스', 법인등록번호: '134411-0001387', 사업자등록번호: 1268103725 },
    { PID: '8', 기업명: '삼성에스디에스', 법인등록번호: '1101110398135', 사업자등록번호: '' },
    { PID: '9', 기업명: '대림(대림코퍼레이션에서사명변경)', 법인등록번호: '', 사업자등록번호: '' },
    { PID: '10', 기업명: '(주)한국삼성', 법인등록번호: '', 사업자등록번호: '' },
  ],
};

const config = {
  lookupId: 'lut-1',
  labelColumn: '기업명',
  fills: [
    { column: '법인등록번호', cellId: 'corp' },
    { column: '사업자등록번호', cellId: 'biz' },
  ],
};

describe('resolveLookupSearch', () => {
  it('설정의 참조표와 표시 열을 찾는다', () => {
    const resolved = resolveLookupSearch(config, [companies]);
    expect(resolved?.lookup).toBe(companies);
    expect(resolved?.fills).toEqual(config.fills);
  });

  it('참조표가 없거나 표시 열이 없으면 null — 평범한 입력칸으로 그린다', () => {
    expect(resolveLookupSearch(undefined, [companies])).toBeNull();
    expect(resolveLookupSearch({ ...config, lookupId: 'gone' }, [companies])).toBeNull();
    expect(resolveLookupSearch({ ...config, labelColumn: '없는 열' }, [companies])).toBeNull();
  });

  it('참조표에 없는 열·빈 칸 id 를 가리키는 채우기는 버린다', () => {
    const resolved = resolveLookupSearch(
      {
        ...config,
        fills: [
          { column: '없는 열', cellId: 'x' },
          { column: 'PID', cellId: '' },
          { column: 'PID', cellId: 'pid' },
        ],
      },
      [companies],
    );
    expect(resolved?.fills).toEqual([{ column: 'PID', cellId: 'pid' }]);
  });
});

describe('normalizeLookupSearchText', () => {
  it('공백·법인 표기·괄호를 걷고 소문자로 맞춘다', () => {
    expect(normalizeLookupSearchText(' (주) 삼성 전자 ')).toBe('삼성전자');
    expect(normalizeLookupSearchText('㈜NHN 클라우드')).toBe('nhn클라우드');
    expect(normalizeLookupSearchText('주식회사 카카오')).toBe('카카오');
  });

  it('조합 중인 끝 자모는 뺀다 — 「삼ㅅ」 도 「삼」 으로 찾는다', () => {
    expect(normalizeLookupSearchText('삼ㅅ')).toBe('삼');
  });

  it('자모가 분리된(NFD) 글자도 같은 글자로 본다', () => {
    expect(normalizeLookupSearchText('삼성'.normalize('NFD'))).toBe('삼성');
  });
});

describe('searchLookupRows', () => {
  const resolved = resolveLookupSearch(config, [companies])!;

  it('포함 검색이고 앞이 맞는 행이 먼저, 그다음 목록 순서', () => {
    expect(searchLookupRows(resolved, '삼성').map((h) => h.label)).toEqual([
      '삼성전자',
      '삼성에스디에스',
      '(주)한국삼성',
    ]);
  });

  it('괄호 안 글자로도 찾는다', () => {
    expect(searchLookupRows(resolved, '코퍼레이션').map((h) => h.index)).toEqual([3]);
  });

  it('빈 검색어는 후보가 없고, 개수는 상한까지', () => {
    expect(searchLookupRows(resolved, '  ')).toEqual([]);
    expect(searchLookupRows(resolved, '삼성', 2)).toHaveLength(2);
  });
});

describe('buildLookupPickPatch', () => {
  const resolved = resolveLookupSearch(config, [companies])!;
  const cells: TableCell[] = [
    { id: 'name', type: 'input', content: '' },
    { id: 'corp', type: 'input', content: '', inputType: 'corp_number' },
    { id: 'biz', type: 'input', content: '', inputType: 'biz_number' },
  ];

  it('이 칸에는 표시 열 값을, 대상 칸에는 형식대로 정돈한 값을 넣는다', () => {
    expect(buildLookupPickPatch(resolved, 1, 'name', cells)).toEqual({
      name: '에스케이하이닉스',
      corp: '134411-0001387',
      biz: '126-81-03725',
    });
  });

  it('형식에 맞지 않는 값은 그대로, 빈 값은 빈 글자로 — 앞서 고른 회사의 번호가 남지 않게', () => {
    expect(buildLookupPickPatch(resolved, 2, 'name', cells)).toEqual({
      name: '삼성에스디에스',
      corp: '110111-0398135',
      biz: '',
    });
  });

  it('입력 칸이 아니거나 병합에 가려졌거나 잠긴 prefill 칸, 자기 자신, 표에 없는 칸은 채우지 않는다', () => {
    const patch = buildLookupPickPatch(
      { ...resolved, fills: [...resolved.fills, { column: 'PID', cellId: 'name' }, { column: 'PID', cellId: 'ghost' }] },
      0,
      'name',
      [
        cells[0]!,
        { id: 'corp', type: 'input', content: '', isHidden: true },
        { id: 'biz', type: 'input', content: '', defaultValueTemplate: '{{사업자번호}}' },
      ],
    );
    expect(patch).toEqual({ name: '삼성전자' });
  });

  it('고칠 수 있는 prefill 칸은 채운다', () => {
    const patch = buildLookupPickPatch(resolved, 0, 'name', [
      cells[0]!,
      cells[1]!,
      { ...cells[2]!, defaultValueTemplate: '{{사업자번호}}', prefillEditable: true },
    ]);
    expect(patch['biz']).toBe('124-81-00998');
  });
});
