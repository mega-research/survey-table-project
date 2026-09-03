import { describe, expect, it } from 'vitest';

import { questionShortCode } from './label';

describe('questionShortCode', () => {
  it('엑셀 라벨이 있으면 그것을 먼저 쓴다', () => {
    // 사람이 조사표에서 찾는 이름은 엑셀 라벨 쪽이다. 문항코드는 SPSS 변수명이라
    // 발번 규칙을 따르고, 원본 조사표에 없는 문자열이 되기도 한다.
    expect(questionShortCode({ exportLabel: 'B6-가', questionCode: 'B6_A' })).toBe('B6-가');
  });

  it('엑셀 라벨이 비었으면 문항코드로 내려간다', () => {
    // 실제 데이터에 null 뿐 아니라 빈 문자열도 흔하다 — 빌더가 placeholder 만 보여
    // 저장되지 않은 칸이 그렇게 남는다.
    for (const exportLabel of [null, '', '   ']) {
      expect(questionShortCode({ exportLabel, questionCode: 'B6_A' })).toBe('B6_A');
    }
    expect(questionShortCode({ questionCode: 'B6_A' })).toBe('B6_A');
  });

  it('둘 다 없으면 null — 문장으로 대신하지 않는다', () => {
    // 이 값이 들어가는 자리는 좁은 코드 칸이다. 문장을 넣으면 칸이 무너진다.
    expect(questionShortCode({ exportLabel: '  ', questionCode: null })).toBeNull();
    expect(questionShortCode({})).toBeNull();
  });

  it('앞뒤 공백은 떼어 낸다', () => {
    expect(questionShortCode({ exportLabel: ' B6-가 ' })).toBe('B6-가');
  });
});
