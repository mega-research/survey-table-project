import { describe, expect, it } from 'vitest';

import {
  type FallbackEmailCandidate,
  fallbackCampaignTitle,
  pickFallbackAddress,
} from './fallback-address';

const c = (columnKey: string, email: string, blindIndex = `b:${email}`): FallbackEmailCandidate => ({
  columnKey,
  email,
  blindIndex,
});
const ceo = c('대표자 e-mail', 'ceo@a.com');
const staff = c('실무자 e-mail', 'staff@a.com');
const staff2 = c('실무자 e-mail__2', 'staff2@a.com');
const none = new Set<string>();

describe('pickFallbackAddress', () => {
  it('쓴 열의 다음 순위 열을 고른다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBe(staff);
  });

  it('2순위도 실패하면 3순위로 — 사슬에서 보낸 주소는 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '실무자 e-mail',
        usedEmail: 'staff@a.com',
        triedEmails: ['staff@a.com', 'ceo@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBe(staff2);
  });

  it('마지막 순위면 더 보낼 곳이 없다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: '실무자 e-mail',
        usedEmail: 'staff@a.com',
        triedEmails: ['staff@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBeNull();
  });

  it('다음 열이 이미 보낸 주소와 같으면 건너뛴다 — 대소문자·여러 주소 칸도', () => {
    const dupStaff = c('실무자 e-mail', 'CEO@a.com');
    expect(
      pickFallbackAddress({
        candidates: [c('대표자 e-mail', 'ceo@a.com / x@a.com'), dupStaff, staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com / x@a.com',
        triedEmails: ['ceo@a.com / x@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBe(staff2);
  });

  it('이 설문에서 반송된 적 있는 주소의 열은 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff, staff2],
        usedColumnKey: '대표자 e-mail',
        usedEmail: 'ceo@a.com',
        triedEmails: ['ceo@a.com'],
        bouncedBlindIndexes: new Set([staff.blindIndex]),
      }),
    ).toBe(staff2);
  });

  it('쓴 열을 모르면 주소 값으로 찾고, 그것도 없으면 처음부터 보되 보낸 주소는 건너뛴다', () => {
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: null,
        usedEmail: ' ceo@a.com ',
        triedEmails: ['ceo@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBe(staff);
    expect(
      pickFallbackAddress({
        candidates: [ceo, staff],
        usedColumnKey: null,
        usedEmail: 'old@a.com',
        triedEmails: ['old@a.com'],
        bouncedBlindIndexes: none,
      }),
    ).toBe(ceo);
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
