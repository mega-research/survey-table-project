import { describe, expect, it } from 'vitest';

import {
  canExposeToRespondent,
  carryOverRespondentVisible,
  formatRespondentPiiValue,
  mergeRespondentAttrs,
  resolveRespondentVisiblePiiKeys,
  validateRespondentVisible,
} from '@/lib/contacts/respondent-visible-pii';
import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

const pii = (key: string, over: Partial<ContactColumnDef> = {}): ContactColumnDef => ({
  key,
  label: key,
  source: `pii.${key}`,
  order: 1,
  piiType: 'biz_number',
  ...over,
});
const attr = (key: string, over: Partial<ContactColumnDef> = {}): ContactColumnDef => ({
  key,
  label: key,
  source: `attrs.${key}`,
  order: 1,
  ...over,
});
const scheme = (columns: ContactColumnDef[]): ContactColumnScheme => ({
  version: 1,
  headerRow: 1,
  columns,
});

describe('응답 화면 노출 판정', () => {
  it('개인정보 열만 노출을 켤 수 있다', () => {
    expect(canExposeToRespondent(pii('사업자등록번호'))).toBe(true);
    expect(canExposeToRespondent(attr('기업명'))).toBe(false);
    expect(canExposeToRespondent({ source: 'system.resid' })).toBe(false);
  });

  it('노출을 켠 개인정보 열의 column_key 만 고른다', () => {
    const keys = resolveRespondentVisiblePiiKeys(
      scheme([
        pii('사업자등록번호', { respondentVisible: true }),
        pii('대표자 e-mail', { piiType: 'email' }),
        attr('기업명', { respondentVisible: true }),
      ]),
    );
    expect(keys).toEqual(['사업자등록번호']);
  });

  it('스킴이 없거나 깨졌으면 빈 목록', () => {
    expect(resolveRespondentVisiblePiiKeys(null)).toEqual([]);
    expect(resolveRespondentVisiblePiiKeys({ columns: 'x' as never })).toEqual([]);
  });

  it('저장 가드 — attrs 열에 노출을 켜면 거부한다', () => {
    expect(validateRespondentVisible([pii('a', { respondentVisible: true })])).toBeNull();
    expect(validateRespondentVisible([attr('b', { respondentVisible: true })])).toBe(
      '응답 화면 노출은 개인정보로 암호화된 열에만 지정할 수 있습니다.',
    );
  });
});

describe('formatRespondentPiiValue', () => {
  it('10자리 사업자번호는 하이픈을 넣는다', () => {
    expect(formatRespondentPiiValue('biz_number', '1234567890')).toBe('123-45-67890');
  });

  it('자릿수가 다르거나 다른 종류면 그대로 둔다', () => {
    expect(formatRespondentPiiValue('biz_number', '123456789')).toBe('123456789');
    expect(formatRespondentPiiValue('mobile', '01012345678')).toBe('01012345678');
    expect(formatRespondentPiiValue('name', '홍길동')).toBe('홍길동');
  });
});

describe('mergeRespondentAttrs', () => {
  it('attrs 에 노출 값을 덧붙이고, 같은 키는 attrs 가 이긴다', () => {
    expect(
      mergeRespondentAttrs({ 기업명: '가나', 사업자등록번호: 'attrs값' }, {
        사업자등록번호: '123-45-67890',
        대표자: '홍길동',
      }),
    ).toEqual({ 기업명: '가나', 사업자등록번호: 'attrs값', 대표자: '홍길동' });
  });

  it('빈 값은 키를 만들지 않는다', () => {
    expect(mergeRespondentAttrs({}, { 사업자등록번호: '' })).toEqual({});
  });
});

describe('carryOverRespondentVisible', () => {
  it('교체 업로드 뒤에도 같은 이름의 개인정보 열에 노출 설정을 옮긴다', () => {
    const next = carryOverRespondentVisible(
      scheme([pii('사업자등록번호'), attr('기업명')]),
      scheme([pii('사업자등록번호', { respondentVisible: true }), attr('기업명')]),
    );
    expect(next.columns.map((c) => c.respondentVisible)).toEqual([true, undefined]);
  });

  it('새 스킴에서 attrs 열이 됐으면 옮기지 않는다', () => {
    const next = carryOverRespondentVisible(
      scheme([attr('사업자등록번호')]),
      scheme([pii('사업자등록번호', { respondentVisible: true })]),
    );
    expect(next.columns[0]?.respondentVisible).toBeUndefined();
  });
});
