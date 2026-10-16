import { describe, expect, it } from 'vitest';

import {
  type FallbackEmailCandidate,
  fallbackCampaignTitle,
  pickFallbackAddress,
  remainingSendValue,
} from './fallback-address';

const c = (columnKey: string, email: string): FallbackEmailCandidate => ({ columnKey, email });
const ceo = c('대표자 e-mail', 'ceo@a.com');
const staff = c('실무자 e-mail', 'staff@a.com');
const staff2 = c('실무자 e-mail__2', 'staff2@a.com');
const notBounced = () => false;
const bouncedOf = (...addresses: string[]) => {
  const set = new Set(addresses.map((a) => a.toLowerCase()));
  return (address: string) => set.has(address.trim().toLowerCase());
};

describe('pickFallbackAddress', () => {
  it('쓴 열의 다음 순위 열을 고른다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '실무자 e-mail', email: 'staff@a.com' });
  });

  it('2순위도 실패하면 3순위로 — 사슬에서 보낸 주소는 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '실무자 e-mail',
        usedEmail: 'staff@a.com',
        triedEmails: ['staff@a.com', 'ceo@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '실무자 e-mail__2', email: 'staff2@a.com' });
  });

  it('마지막 순위면 더 보낼 곳이 없다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: '실무자 e-mail',
        usedEmail: 'staff@a.com',
        triedEmails: ['staff@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toBeNull();
  });

  it('다음 열이 이미 보낸 주소와 같으면 건너뛴다 — 대소문자·여러 주소 칸도', () => {
    expect(
      pickFallbackAddress({
        candidates: [c('대표자 e-mail', 'ceo@a.com / x@a.com'), c('실무자 e-mail', 'CEO@a.com'), staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com / x@a.com',
        triedEmails: ['ceo@a.com / x@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '실무자 e-mail__2', email: 'staff2@a.com' });
  });

  it('다음 칸에 보낸 주소와 새 주소가 섞여 있으면 새 주소만 보낸다 (2026-10-16 리뷰)', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, c('실무자 e-mail', 'ceo@a.com / new@a.com')],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '실무자 e-mail', email: 'new@a.com' });
  });

  it('반송된 주소는 다른 칸에 섞여 있어도 빼고, 칸의 주소가 전부 반송이면 그 열을 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, c('실무자 e-mail', 'dead@a.com, live@a.com'), staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        isBouncedAddress: bouncedOf('dead@a.com'),
      }),
    ).toEqual({ columnKey: '실무자 e-mail', email: 'live@a.com' });
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        isBouncedAddress: bouncedOf('staff@a.com'),
      }),
    ).toEqual({ columnKey: '실무자 e-mail__2', email: 'staff2@a.com' });
  });

  it('쓴 열을 모르면 주소 값으로 찾고, 그것도 없으면 처음부터 보되 보낸 주소는 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: null,
        usedEmail: ' ceo@a.com ',
        triedEmails: ['ceo@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '실무자 e-mail', email: 'staff@a.com' });
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: null,
        usedEmail: 'old@a.com',
        triedEmails: ['old@a.com'],
        isBouncedAddress: notBounced,
      }),
    ).toEqual({ columnKey: '대표자 e-mail', email: 'ceo@a.com' });
  });
});

describe('remainingSendValue', () => {
  it('빠지는 주소가 없으면 칸 값을 그대로 돌려준다', () => {
    expect(remainingSendValue('a@x.com / b@y.com', notBounced)).toBe('a@x.com / b@y.com');
  });

  it('빠진 주소를 제외하고 쉼표로 잇고, 다 빠지면 null', () => {
    expect(remainingSendValue('a@x.com / b@y.com', bouncedOf('a@x.com'))).toBe('b@y.com');
    expect(remainingSendValue('a@x.com / b@y.com', bouncedOf('a@x.com', 'b@y.com'))).toBeNull();
  });

  it('주소 모양이 없는 칸은 칸 값 하나로 판정한다', () => {
    expect(remainingSendValue('kim@naver', notBounced)).toBe('kim@naver');
    expect(remainingSendValue('kim@naver', bouncedOf('kim@naver'))).toBeNull();
  });
});

describe('fallbackCampaignTitle', () => {
  it('원래 회차 → 「· 대체 발송」, 대체의 대체 → 2차·3차', () => {
    expect(fallbackCampaignTitle('10월 안내', false)).toBe('10월 안내 · 대체 발송');
    expect(fallbackCampaignTitle('10월 안내 · 대체 발송', true)).toBe('10월 안내 · 대체 발송 2차');
    expect(fallbackCampaignTitle('10월 안내 · 대체 발송 2차', true)).toBe('10월 안내 · 대체 발송 3차');
  });

  it('부모가 대체 회차가 아니면 제목에 같은 글이 있어도 1차로 붙인다', () => {
    expect(fallbackCampaignTitle('a · 대체 발송', false)).toBe('a · 대체 발송 · 대체 발송');
  });
});
