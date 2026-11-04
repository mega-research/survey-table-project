import { describe, expect, it } from 'vitest';

import {
  splitContactTokenKeys,
  substituteTokens,
  substituteTokensInHtml,
} from '@/lib/survey/substitute-tokens';

// ========================
// 명단 토큰 대체 문법 `{{a || b}}` — 왼쪽부터 처음으로 값이 있는 열 하나를 쓴다
// (.scratch/token-fallback/PRD.md). 출처가 여럿인 명단에서 열이 갈린 값(업체명 / DQ2)을
// 「있는 쪽」으로 고르기 위한 것이라, 이어 붙이지 않고 하나에서 멈추는 것이 계약이다.
// ========================

describe('splitContactTokenKeys', () => {
  it('|| 로 나누고 조각마다 공백을 걷는다', () => {
    expect(splitContactTokenKeys(' 업체명 || DQ2 ')).toEqual(['업체명', 'DQ2']);
  });

  it('빈 조각은 버린다', () => {
    expect(splitContactTokenKeys('a || ')).toEqual(['a']);
    expect(splitContactTokenKeys('|| a ||  || b')).toEqual(['a', 'b']);
    expect(splitContactTokenKeys('||')).toEqual([]);
  });

  it('|| 가 없으면 공백만 걷은 키 하나다 — 단일 | 는 열 이름의 일부', () => {
    expect(splitContactTokenKeys(' 전시회명(영문) ')).toEqual(['전시회명(영문)']);
    expect(splitContactTokenKeys('a | b')).toEqual(['a | b']);
  });
});

describe('substituteTokens — 대체 문법', () => {
  it('앞 열에 값이 있으면 앞 열만 쓴다 — 이어 붙이지 않는다', () => {
    expect(substituteTokens('{{업체명 || DQ2}}', { 업체명: '터리낙스', DQ2: '터리낙스_확인' })).toBe(
      '터리낙스',
    );
  });

  it('앞 열이 비거나 없으면 다음 열', () => {
    expect(substituteTokens('{{업체명 || DQ2}}', { 업체명: '', DQ2: '동남종합상사' })).toBe(
      '동남종합상사',
    );
    expect(substituteTokens('{{업체명 || DQ2}}', { DQ2: '동남종합상사' })).toBe('동남종합상사');
  });

  it('공백만 있는 열은 값이 없는 것으로 건너뛴다', () => {
    expect(substituteTokens('{{a || b}}', { a: '  ', b: 'B' })).toBe('B');
  });

  it('셋 이상 이어 쓸 수 있다', () => {
    const tpl = '{{전시회명(영문) || Q0 || Q0_1}}';
    expect(substituteTokens(tpl, { Q0: '제25회 국제포장기자재전' })).toBe('제25회 국제포장기자재전');
    expect(
      substituteTokens(tpl, { Q0_1: '2026 코리아 엑스포 파리', '전시회명(영문)': 'Korea Expo Paris 2026' }),
    ).toBe('Korea Expo Paris 2026');
    expect(substituteTokens(tpl, { Q0_1: '2026 베트남환경에너지산업전' })).toBe(
      '2026 베트남환경에너지산업전',
    );
  });

  it('모두 비면 빈 글자', () => {
    expect(substituteTokens('[{{a || b}}]', { a: '', b: ' ' })).toBe('[]');
    expect(substituteTokens('[{{||}}]', { '': 'X' })).toBe('[]');
  });

  it('고른 값은 원래 값 그대로 — 공백을 걷지 않는다', () => {
    expect(substituteTokens('{{a || b}}', { a: ' A ' })).toBe(' A ');
  });

  it('|| 없는 단일 키는 종전 그대로 — 공백만 있는 값도 그대로 쓴다', () => {
    expect(substituteTokens('[{{a}}]', { a: '  ' })).toBe('[  ]');
  });

  it('인용값 안의 대체 식은 다시 치환되지 않는다 (단일 패스)', () => {
    expect(
      substituteTokens('{{{기타}}}', { 업체명: '남의 회사' }, { 기타: '{{업체명 || DQ2}}' }),
    ).toBe('{{업체명 || DQ2}}');
  });

  it('응답 인용 {{{…}}} 에는 대체 문법을 적용하지 않는다', () => {
    expect(substituteTokens('{{{a || b}}}', {}, { b: 'B' })).toBe('');
  });
});

describe('substituteTokensInHtml — 대체 문법', () => {
  it('서식 태그가 끼어도 조각을 골라 치환하고 태그를 남긴다', () => {
    expect(
      substituteTokensInHtml('<p>{{<strong>업체명</strong> || DQ2}}</p>', { DQ2: '리팩' }),
    ).toBe('<p><strong>리팩</strong></p>');
  });

  it('고른 값은 escape 된다', () => {
    expect(substituteTokensInHtml('{{a || b}}', { b: '<b>R&D</b>' })).toBe(
      '&lt;b&gt;R&amp;D&lt;/b&gt;',
    );
  });
});
