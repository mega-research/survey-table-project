import { describe, expect, it } from 'vitest';

import { DEFAULT_RESULT_CODES, type ContactResultCode } from '@/shared/contracts/contacts';

import {
  isResultCodeRowMark,
  resolveCodeRowMark,
  resolveContactRowMark,
} from './result-code-row-mark';

const code = (c: string, extra: Partial<ContactResultCode> = {}): ContactResultCode => ({
  code: c,
  label: c,
  order: 1,
  ...extra,
});

describe('resolveCodeRowMark', () => {
  it('고르지 않았으면 코드에서 읽는다 — 긍정 상태는 끝난 대상', () => {
    expect(resolveCodeRowMark(code('1.조사완료', { status: 'positive' }))).toBe('done');
    // status 가 빠진 옛 저장분도 `1.조사완료` 는 긍정으로 본다(resolveCodeStatus 와 같은 폴백).
    expect(resolveCodeRowMark(code('1.조사완료'))).toBe('done');
    expect(resolveCodeRowMark(code('전화완료', { status: 'positive' }))).toBe('done');
  });

  it('고르지 않았으면 수신거부·조사대상아님은 빠지는 대상', () => {
    expect(resolveCodeRowMark(code('수신거부', { status: 'neutral' }))).toBe('out');
    expect(resolveCodeRowMark(code('14.수신거부'))).toBe('out');
    expect(resolveCodeRowMark(code('12.조사대상아님'))).toBe('out');
    expect(resolveCodeRowMark(code('12. 조사 대상 아님'))).toBe('out');
  });

  it('그 밖의 코드는 표시 없음 — 붉은 색상 톤이나 부정 상태만으로는 붉어지지 않는다', () => {
    expect(resolveCodeRowMark(code('6.거절', { tone: 'rose' }))).toBe('none');
    expect(resolveCodeRowMark(code('7.결번·번호오류', { tone: 'rose', status: 'negative' }))).toBe(
      'none',
    );
    expect(resolveCodeRowMark(code('4.부재'))).toBe('none');
  });

  it('설정에서 고른 값이 기본값을 이긴다 — 끄기도 된다', () => {
    expect(resolveCodeRowMark(code('1.조사완료', { status: 'positive', rowMark: 'none' }))).toBe(
      'none',
    );
    expect(resolveCodeRowMark(code('수신거부', { rowMark: 'none' }))).toBe('none');
    expect(resolveCodeRowMark(code('9.휴/폐업', { rowMark: 'out' }))).toBe('out');
    expect(resolveCodeRowMark(code('8.중복', { rowMark: 'done' }))).toBe('done');
  });

  it('모르는 값이 저장돼 있으면 고르지 않은 것으로 본다', () => {
    expect(
      resolveCodeRowMark(code('수신거부', { rowMark: 'red' as unknown as 'out' })),
    ).toBe('out');
  });

  it('기본 결과코드 목록 — 조사완료만 끝난 대상, 수신거부만 빠지는 대상', () => {
    const marks = Object.fromEntries(DEFAULT_RESULT_CODES.map((c) => [c.code, resolveCodeRowMark(c)]));
    expect(Object.entries(marks).filter(([, m]) => m === 'done').map(([c]) => c)).toEqual([
      '1.조사완료',
    ]);
    expect(Object.entries(marks).filter(([, m]) => m === 'out').map(([c]) => c)).toEqual([
      '수신거부',
    ]);
  });
});

describe('resolveContactRowMark', () => {
  const codes = [
    code('1.조사완료', { status: 'positive' }),
    code('4.부재'),
    code('12.조사대상아님'),
    code('수신거부', { status: 'neutral' }),
  ];

  it('온라인 응답완료는 지금처럼 끝난 대상', () => {
    expect(resolveContactRowMark({ responded: true, latestResultCode: null }, codes)).toBe('done');
    expect(resolveContactRowMark({ responded: true, latestResultCode: '4.부재' }, codes)).toBe('done');
  });

  it('응답이 없어도 마지막 컨택결과가 조사완료면 끝난 대상', () => {
    expect(resolveContactRowMark({ responded: false, latestResultCode: '1.조사완료' }, codes)).toBe(
      'done',
    );
  });

  it('마지막 컨택결과가 수신거부·조사대상아님이면 빠지는 대상', () => {
    expect(resolveContactRowMark({ responded: false, latestResultCode: '수신거부' }, codes)).toBe('out');
    expect(
      resolveContactRowMark({ responded: false, latestResultCode: '12.조사대상아님' }, codes),
    ).toBe('out');
  });

  it('둘 다 해당하면 빠지는 쪽이 이긴다', () => {
    expect(
      resolveContactRowMark({ responded: true, latestResultCode: '12.조사대상아님' }, codes),
    ).toBe('out');
  });

  it('컨택결과가 없거나 표시 없는 코드면 표시 없음', () => {
    expect(resolveContactRowMark({ responded: false, latestResultCode: null }, codes)).toBe('none');
    expect(resolveContactRowMark({ responded: false, latestResultCode: '4.부재' }, codes)).toBe('none');
  });

  it('목록에서 지워진 옛 코드는 코드 글자로 기본값을 읽는다', () => {
    expect(resolveContactRowMark({ responded: false, latestResultCode: '옛.수신거부' }, codes)).toBe(
      'out',
    );
    expect(resolveContactRowMark({ responded: false, latestResultCode: '1.조사완료' }, [])).toBe('done');
    expect(resolveContactRowMark({ responded: false, latestResultCode: '옛.기타' }, codes)).toBe('none');
  });
});

describe('isResultCodeRowMark', () => {
  it('세 값만 받는다', () => {
    expect(['none', 'done', 'out'].every(isResultCodeRowMark)).toBe(true);
    expect([undefined, null, '', 'red', 1].some(isResultCodeRowMark)).toBe(false);
  });
});
