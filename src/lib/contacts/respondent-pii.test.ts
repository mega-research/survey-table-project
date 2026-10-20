import { describe, expect, it } from 'vitest';

import {
  collectReferencedContactKeys,
  formatRespondentPiiValue,
  mergeRespondentAttrs,
} from '@/lib/contacts/respondent-pii';

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
  it('attrs 에 개인정보 값을 덧붙이고, 같은 키는 attrs 가 이긴다', () => {
    expect(
      mergeRespondentAttrs(
        { 기업명: '가나', 사업자등록번호: 'attrs값' },
        { 사업자등록번호: '123-45-67890', 대표자: '홍길동' },
      ),
    ).toEqual({ 기업명: '가나', 사업자등록번호: 'attrs값', 대표자: '홍길동' });
  });

  it('빈 값은 키를 만들지 않는다', () => {
    expect(mergeRespondentAttrs({}, { 사업자등록번호: '' })).toEqual({});
  });
});

describe('collectReferencedContactKeys', () => {
  it('셀 프리필·본문·서식본의 명단 토큰을 모은다', () => {
    const snapshot = {
      questions: [
        {
          title: '{{ 기업명 }} 의 현황',
          tableRowsData: [{ cells: [{ defaultValueTemplate: '{{사업자등록번호}}' }] }],
        },
        { type: 'notice', noticeContent: '<p>{{<strong>대표자명</strong>}} 님</p>' },
        { titleHtml: '{{R&amp;D 담당}}' },
      ],
    };
    expect([...collectReferencedContactKeys(snapshot)].sort()).toEqual(
      ['R&D 담당', '기업명', '대표자명', '사업자등록번호'].sort(),
    );
  });

  it('응답 인용 토큰 {{{이름}}} 은 명단 값이 아니라 빼고, 이어지는 명단 토큰은 모은다', () => {
    const keys = collectReferencedContactKeys({ t: '{{{매출액}}} 과 {{기업명}}' });
    expect([...keys]).toEqual(['기업명']);
  });

  it('표시 조건·계산 수식의 attrsKey 참조를 모은다', () => {
    const keys = collectReferencedContactKeys({
      displayCondition: { right: { kind: 'attr', attrsKey: '대표 "직위"' } },
      formula: { kind: 'lookup', keyMapping: [{ lutKey: 'k', attrsKey: '지역' }] },
    });
    expect([...keys].sort()).toEqual(['대표 "직위"', '지역'].sort());
  });

  it('구조가 없으면 빈 집합', () => {
    expect(collectReferencedContactKeys(null).size).toBe(0);
  });
});
