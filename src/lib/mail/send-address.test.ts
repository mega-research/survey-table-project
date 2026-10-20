import { describe, expect, it } from 'vitest';

import {
  type SendAddressCell,
  pickSendAddress,
  remainingSendValue,
  resolveSendAddress,
  sendableValue,
} from './send-address';

const cell = (columnKey: string, value: string | null): SendAddressCell => ({ columnKey, value });
const excludedOf = (...values: string[]) => {
  const set = new Set(values.map((v) => v.toLowerCase()));
  return (v: string) => set.has(v.trim().toLowerCase());
};

describe('remainingSendValue', () => {
  it('빠지는 주소가 없으면 칸 값을 그대로 돌려준다', () => {
    expect(remainingSendValue('a@x.com / b@x.com', () => false)).toBe('a@x.com / b@x.com');
  });

  it('빠진 주소를 제외하고 쉼표로 잇고, 다 빠지면 null', () => {
    expect(remainingSendValue('a@x.com / b@x.com / c@x.com', excludedOf('b@x.com'))).toBe(
      'a@x.com, c@x.com',
    );
    expect(remainingSendValue('a@x.com, b@x.com', excludedOf('a@x.com', 'b@x.com'))).toBeNull();
  });

  it('주소 모양이 없는 칸은 칸 값 하나로 판정한다', () => {
    expect(remainingSendValue('not-an-address', () => false)).toBe('not-an-address');
    expect(remainingSendValue('not-an-address', excludedOf('not-an-address'))).toBeNull();
  });
});

describe('sendableValue', () => {
  it('빈 칸·공백 칸은 보낼 수 없다', () => {
    expect(sendableValue('', () => false)).toBeNull();
    expect(sendableValue('   ', () => false)).toBeNull();
  });

  it('칸째 제외(여러 주소 한 통의 반송)면 칸 안 주소가 각각 멀쩡해도 보내지 않는다', () => {
    expect(sendableValue('a@x.com / b@x.com', excludedOf('a@x.com / b@x.com'))).toBeNull();
  });

  it('주소 단위로 빠지는 것은 빼고 남은 주소를 보낸다', () => {
    expect(sendableValue('a@x.com / b@x.com', excludedOf('a@x.com'))).toBe('b@x.com');
  });
});

describe('pickSendAddress', () => {
  it('순서대로 보낼 수 있는 첫 칸 — 복호화 실패·빈 칸은 건너뛴다', () => {
    expect(
      pickSendAddress([
        cell('A', null),
        cell('B', '  '),
        cell('C', 'c@x.com'),
        cell('D', 'd@x.com'),
      ]),
    ).toEqual({ columnKey: 'C', email: 'c@x.com' });
  });

  it('제외되는 칸은 건너뛰고 다음 순위로', () => {
    expect(
      pickSendAddress([cell('A', 'a@x.com'), cell('B', 'b@x.com')], excludedOf('a@x.com')),
    ).toEqual({ columnKey: 'B', email: 'b@x.com' });
  });

  it('보낼 칸이 없으면 null', () => {
    expect(pickSendAddress([])).toBeNull();
    expect(pickSendAddress([cell('A', 'a@x.com')], excludedOf('a@x.com'))).toBeNull();
  });
});

describe('resolveSendAddress', () => {
  it('보낼 칸이 있으면 send', () => {
    expect(resolveSendAddress([cell('A', 'a@x.com')])).toEqual({
      kind: 'send',
      columnKey: 'A',
      email: 'a@x.com',
    });
  });

  it('쓸 수 있는 값이 하나도 없으면 missing', () => {
    expect(resolveSendAddress([])).toEqual({ kind: 'missing' });
    expect(resolveSendAddress([cell('A', null), cell('B', '')])).toEqual({ kind: 'missing' });
  });

  it('쓸 수 있는 칸이 전부 반송이면 bounced — 복호화 실패 칸이 섞여도', () => {
    expect(
      resolveSendAddress([cell('A', 'a@x.com'), cell('B', null)], excludedOf('a@x.com')),
    ).toEqual({ kind: 'bounced' });
  });

  it('칸 「a, c」의 주소가 각각 반송이면 bounced', () => {
    expect(
      resolveSendAddress([cell('A', 'a@x.com, c@x.com')], excludedOf('a@x.com', 'c@x.com')),
    ).toEqual({ kind: 'bounced' });
  });

  it('1순위가 반송이고 2순위가 살아 있으면 2순위로 send', () => {
    expect(
      resolveSendAddress([cell('A', 'a@x.com'), cell('B', 'b@x.com')], excludedOf('a@x.com')),
    ).toEqual({ kind: 'send', columnKey: 'B', email: 'b@x.com' });
  });
});
