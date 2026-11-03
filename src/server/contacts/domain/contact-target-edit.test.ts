import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme } from '@/shared/contracts/contacts';

import { diffContactTargetInfo } from './contact-target-edit';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '사업자등록증기업명', label: '사업자등록증기업명', source: 'attrs.사업자등록증기업명', order: 1 },
    { key: '명단기업명', label: '명단 기업명', source: 'attrs.명단기업명', order: 2, hidden: true },
    { key: '대표자', label: '대표자 휴대폰', source: 'pii.대표자', order: 3, piiType: 'mobile' },
  ],
};

const base = { attrs: {}, memo: null, contactMethod: null };

describe('diffContactTargetInfo — 대상 정보 저장의 변경 목록', () => {
  it('바뀐 attrs 칸마다 저장 시점 열 이름으로 이전 값 → 새 값을 낸다(숨김 열 포함)', () => {
    const changes = diffContactTargetInfo(
      { ...base, attrs: { 사업자등록증기업명: '-', 명단기업명: '-', 지역: '서울' } },
      { ...base, attrs: { 사업자등록증기업명: '아리오나트', 명단기업명: '아리오나트', 지역: '서울' } },
      scheme,
    );
    expect(changes).toEqual([
      { kind: 'attr', key: '사업자등록증기업명', label: '사업자등록증기업명', before: '-', after: '아리오나트' },
      { kind: 'attr', key: '명단기업명', label: '명단 기업명', before: '-', after: '아리오나트' },
    ]);
  });

  it('스킴에 없는 attrs 키는 키를 이름으로 쓴다', () => {
    const changes = diffContactTargetInfo(
      { ...base, attrs: { 비고열: 'a' } },
      { ...base, attrs: { 비고열: 'b' } },
      null,
    );
    expect(changes).toEqual([{ kind: 'attr', key: '비고열', label: '비고열', before: 'a', after: 'b' }]);
  });

  it('키가 새로 생기거나 없어진 것도 변경이다', () => {
    const changes = diffContactTargetInfo(
      { ...base, attrs: { 없어질열: '값' } },
      { ...base, attrs: { 새열: '새값' } },
      null,
    );
    expect(changes).toEqual([
      { kind: 'attr', key: '없어질열', label: '없어질열', before: '값', after: '' },
      { kind: 'attr', key: '새열', label: '새열', before: '', after: '새값' },
    ]);
  });

  it('null·빈 문자열·없는 키는 같은 빈 값이라 변경이 아니다', () => {
    const changes = diffContactTargetInfo(
      { attrs: { a: '' }, memo: null, contactMethod: null },
      { attrs: { b: '' }, memo: '', contactMethod: null },
      null,
    );
    expect(changes).toEqual([]);
  });

  it('바뀐 것이 없으면 빈 목록이다', () => {
    const same = { attrs: { a: '1', b: '2' }, memo: '메모', contactMethod: 'email' as const };
    expect(diffContactTargetInfo(same, { ...same, attrs: { b: '2', a: '1' } }, scheme)).toEqual([]);
  });

  it('메모와 컨택 방법 변경을 낸다', () => {
    const changes = diffContactTargetInfo(
      { attrs: {}, memo: '금일중 재통화', contactMethod: 'email' },
      { attrs: {}, memo: null, contactMethod: 'sms' },
      null,
    );
    expect(changes).toEqual([
      { kind: 'memo', before: '금일중 재통화', after: '' },
      { kind: 'contactMethod', before: 'email', after: 'sms' },
    ]);
  });

  it('1,000자를 넘는 값은 1,000자에서 자르고 잘림 표식을 단다', () => {
    const long = '가'.repeat(1200);
    const exact = '나'.repeat(1000);
    const changes = diffContactTargetInfo(
      { attrs: { 긴열: exact }, memo: long, contactMethod: null },
      { attrs: { 긴열: long }, memo: 'x', contactMethod: null },
      null,
    );
    expect(changes).toEqual([
      { kind: 'attr', key: '긴열', label: '긴열', before: exact, after: '가'.repeat(1000), afterTruncated: true },
      { kind: 'memo', before: '가'.repeat(1000), after: 'x', beforeTruncated: true },
    ]);
  });

  it('자르는 자리가 이모지 한가운데여도 글자를 깨뜨리지 않는다', () => {
    const value = `${'a'.repeat(999)}😀😀`;
    const [change] = diffContactTargetInfo(
      { ...base, attrs: { k: '' } },
      { ...base, attrs: { k: value } },
      null,
    );
    expect(change).toMatchObject({ after: `${'a'.repeat(999)}😀`, afterTruncated: true });
  });
});
