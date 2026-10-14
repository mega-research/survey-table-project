import { describe, expect, it } from 'vitest';

import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

import {
  assignMailOrder,
  carryOverMailOrder,
  resolveMailEmailOrder,
  validateMailEmailOrder,
} from './mail-email-order';

function email(key: string, order: number, mailOrder?: number): ContactColumnDef {
  return {
    key,
    label: key,
    source: `pii.${key}`,
    order,
    piiType: 'email',
    ...(mailOrder != null ? { mailOrder } : {}),
  };
}

const attrs = (key: string, order: number): ContactColumnDef => ({
  key,
  label: key,
  source: `attrs.${key}`,
  order,
});

const scheme = (columns: ContactColumnDef[]): ContactColumnScheme => ({
  version: 1,
  headerRow: 1,
  columns,
});

describe('resolveMailEmailOrder', () => {
  it('어느 열에도 순위가 없으면 null — 종전의 열 이름순 동작으로 남는다', () => {
    expect(resolveMailEmailOrder(scheme([email('대표자 e-mail', 1), email('실무자 e-mail', 2)]))).toBeNull();
    expect(resolveMailEmailOrder(null)).toBeNull();
    expect(resolveMailEmailOrder({ columns: undefined as never })).toBeNull();
  });

  it('순위를 준 열만 순위 오름차순으로 돌려준다', () => {
    const order = resolveMailEmailOrder(
      scheme([
        email('대표자 e-mail', 1),
        email('실무자 e-mail', 2, 1),
        email('실무자 e-mail__2', 3, 2),
      ]),
    );
    expect(order).toEqual(['실무자 e-mail', '실무자 e-mail__2']);
  });

  it('순위 사이의 빈 번호는 무시하고, 같은 순위는 표시 순서가 앞선 열이 먼저다', () => {
    expect(
      resolveMailEmailOrder(scheme([email('a', 1, 5), email('b', 2, 2), email('c', 3, 2)])),
    ).toEqual(['b', 'c', 'a']);
  });

  it('이메일로 암호화되지 않은 열과 잘못된 순위는 버린다', () => {
    const notEmail: ContactColumnDef = { ...attrs('부서', 1), mailOrder: 1 };
    const phone: ContactColumnDef = { ...email('휴대폰', 2, 1), piiType: 'mobile' };
    const zero = email('z', 3, 0);
    const fraction = email('f', 4, 1.5);
    expect(resolveMailEmailOrder(scheme([notEmail, phone, zero, fraction]))).toBeNull();
  });
});

describe('validateMailEmailOrder', () => {
  it('순위가 없거나 올바르면 통과한다', () => {
    expect(validateMailEmailOrder([email('a', 1), attrs('b', 2)])).toBeNull();
    expect(validateMailEmailOrder([email('a', 1, 2), email('b', 2, 1)])).toBeNull();
  });

  it('이메일 열이 아닌 곳의 순위를 거부한다', () => {
    expect(validateMailEmailOrder([{ ...attrs('부서', 1), mailOrder: 1 }])).toContain('이메일');
  });

  it('1 미만이거나 정수가 아닌 순위를 거부한다', () => {
    expect(validateMailEmailOrder([email('a', 1, 0)])).toContain('정수');
    expect(validateMailEmailOrder([email('a', 1, 1.5)])).toContain('정수');
  });

  it('같은 순위를 두 열에 주면 거부한다', () => {
    expect(validateMailEmailOrder([email('a', 1, 1), email('b', 2, 1)])).toContain('같은');
  });
});

describe('assignMailOrder', () => {
  it('비어 있는 순위는 그대로 배정한다', () => {
    const next = assignMailOrder([email('a', 1), email('b', 2)], 1, 1);
    expect(next.map((c) => c.mailOrder)).toEqual([undefined, 1]);
  });

  it('이미 쓰인 순위를 고르면 두 열의 순위를 맞바꾼다', () => {
    const next = assignMailOrder([email('a', 1, 1), email('b', 2, 2)], 1, 1);
    expect(next.map((c) => c.mailOrder)).toEqual([2, 1]);
  });

  it('순위가 없던 열이 남의 순위를 가져가면 그 열은 순위를 잃는다', () => {
    const next = assignMailOrder([email('a', 1, 1), email('b', 2)], 1, 1);
    expect(next.map((c) => c.mailOrder)).toEqual([undefined, 1]);
    expect('mailOrder' in (next[0] as object)).toBe(false);
  });

  it('null 이면 순위를 지우고 필드를 남기지 않는다', () => {
    const next = assignMailOrder([email('a', 1, 1), email('b', 2, 2)], 0, null);
    expect('mailOrder' in (next[0] as object)).toBe(false);
    expect(next[1]?.mailOrder).toBe(2);
  });
});

describe('carryOverMailOrder', () => {
  it('열 이름이 같은 이메일 열에 이전 순위를 이어 붙인다', () => {
    const previous = scheme([email('대표자 e-mail', 1), email('실무자 e-mail', 2, 1)]);
    const next = carryOverMailOrder(
      scheme([email('실무자 e-mail', 1), email('대표자 e-mail', 2), attrs('업체명', 3)]),
      previous,
    );
    expect(resolveMailEmailOrder(next)).toEqual(['실무자 e-mail']);
  });

  it('새 파일에서 이메일 열이 아니게 된 열에는 붙이지 않는다', () => {
    const previous = scheme([email('실무자 e-mail', 1, 1)]);
    const next = carryOverMailOrder(scheme([attrs('실무자 e-mail', 1)]), previous);
    expect(next.columns[0]?.mailOrder).toBeUndefined();
  });

  it('이전 스킴이 없거나 순위가 없으면 그대로 돌려준다', () => {
    const fresh = scheme([email('a', 1)]);
    expect(carryOverMailOrder(fresh, null)).toBe(fresh);
    expect(carryOverMailOrder(fresh, scheme([email('a', 1)]))).toBe(fresh);
  });
});
