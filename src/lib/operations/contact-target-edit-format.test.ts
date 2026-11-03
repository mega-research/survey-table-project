import { describe, expect, it } from 'vitest';

import type { ContactTargetEditChange } from '@/shared/contracts/contacts';

import {
  describeContactTargetEditChange,
  summarizeContactTargetEdit,
  visibleContactTargetEditChanges,
} from './contact-target-edit-format';

const attr = (label: string, before: string, after: string): ContactTargetEditChange => ({
  kind: 'attr',
  key: label,
  label,
  before,
  after,
});

describe('describeContactTargetEditChange — 펼친 줄 문구', () => {
  it('명단 값은 「열 이름 이전 값 → 새 값」, 빈 값은 (빈 값)', () => {
    expect(describeContactTargetEditChange(attr('사업자등록증기업명', '-', '아리오나트'))).toBe(
      '사업자등록증기업명 - → 아리오나트',
    );
    expect(describeContactTargetEditChange(attr('지역', '', '서울'))).toBe('지역 (빈 값) → 서울');
  });

  it('개인정보 열은 값 없이 입력·변경·삭제만', () => {
    const pii = (op: 'set' | 'changed' | 'cleared'): ContactTargetEditChange => ({
      kind: 'pii',
      key: '대표자',
      label: '대표자 휴대폰번호',
      op,
    });
    expect(describeContactTargetEditChange(pii('set'))).toBe('대표자 휴대폰번호 입력');
    expect(describeContactTargetEditChange(pii('changed'))).toBe('대표자 휴대폰번호 변경');
    expect(describeContactTargetEditChange(pii('cleared'))).toBe('대표자 휴대폰번호 삭제');
  });

  it('메모와 컨택 방법(코드 → 화면 글자)', () => {
    expect(describeContactTargetEditChange({ kind: 'memo', before: '금일중', after: '' })).toBe(
      '메모 금일중 → (빈 값)',
    );
    expect(
      describeContactTargetEditChange({ kind: 'contactMethod', before: 'email', after: 'sms' }),
    ).toBe('컨택 방법 이메일 → 문자');
  });

  it('컨택원은 그때 이름으로, 없으면 배정 없음', () => {
    expect(
      describeContactTargetEditChange({
        kind: 'assignment',
        before: { id: 'a', name: '10차' },
        after: { id: 'b', name: '외주 A팀' },
      }),
    ).toBe('컨택원 10차 → 외주 A팀');
    expect(
      describeContactTargetEditChange({
        kind: 'assignment',
        before: null,
        after: { id: 'a', name: '10차' },
      }),
    ).toBe('컨택원 배정 없음 → 10차');
  });

  it('회차 수정은 바뀐 결과·비고, 삭제는 지운 내용째', () => {
    const before = {
      resultCode: '13. 독려',
      note: '금일중',
      createdByEmail: 'a@local',
      createdAt: '2026-10-27T00:35:53.000Z',
    };
    expect(
      describeContactTargetEditChange({
        kind: 'attempt',
        attemptNo: 3,
        before,
        after: { resultCode: '3.비수신', note: '금일중' },
      }),
    ).toBe('3회차 결과 13. 독려 → 3.비수신');
    expect(
      describeContactTargetEditChange({
        kind: 'attempt',
        attemptNo: 3,
        before,
        after: { resultCode: '3.비수신', note: null },
      }),
    ).toBe('3회차 결과 13. 독려 → 3.비수신, 비고 금일중 → (빈 값)');
    expect(
      describeContactTargetEditChange({ kind: 'attempt', attemptNo: 1, before, after: null }),
    ).toBe('1회차 삭제 (13. 독려 · 금일중)');
    expect(
      describeContactTargetEditChange({
        kind: 'attempt',
        attemptNo: 2,
        before: { ...before, note: null },
        after: null,
      }),
    ).toBe('2회차 삭제 (13. 독려)');
  });

  it('기록할 때 잘린 값은 잘렸다고 적는다', () => {
    expect(
      describeContactTargetEditChange({
        kind: 'memo',
        before: '가나다',
        after: '',
        beforeTruncated: true,
      }),
    ).toBe('메모 가나다…(이하 생략) → (빈 값)');
  });
});

describe('summarizeContactTargetEdit — 한 줄 요약', () => {
  it('변경 하나면 그 줄 그대로', () => {
    expect(summarizeContactTargetEdit([attr('사업자등록증기업명', '-', '아리오나트')])).toBe(
      '사업자등록증기업명 - → 아리오나트',
    );
  });

  it('여럿이면 첫 변경 + 외 N개', () => {
    expect(
      summarizeContactTargetEdit([
        attr('사업자등록증기업명', '-', '아리오나트'),
        attr('명단기업명', '-', '아리오나트'),
        { kind: 'memo', before: '', after: '확인' },
      ]),
    ).toBe('사업자등록증기업명 - → 아리오나트 외 2개');
  });

  it('요약 줄의 긴 값은 줄여 보인다', () => {
    const long = '가'.repeat(80);
    expect(summarizeContactTargetEdit([{ kind: 'memo', before: '', after: long }])).toBe(
      `메모 (빈 값) → ${'가'.repeat(30)}…`,
    );
  });

  it('변경이 없으면 빈 글자', () => {
    expect(summarizeContactTargetEdit([])).toBe('');
  });
});

describe('visibleContactTargetEditChanges — 게스트 화면 거르기', () => {
  const assignment: ContactTargetEditChange = {
    kind: 'assignment',
    before: null,
    after: { id: 'a', name: '10차' },
  };

  it('게스트는 컨택원 변경을 받지 않는다', () => {
    const memo: ContactTargetEditChange = { kind: 'memo', before: '', after: 'x' };
    expect(visibleContactTargetEditChanges([memo, assignment], { isGuest: true })).toEqual([memo]);
    expect(visibleContactTargetEditChanges([assignment], { isGuest: true })).toEqual([]);
  });

  it('게스트가 아니면 그대로', () => {
    expect(visibleContactTargetEditChanges([assignment], { isGuest: false })).toEqual([assignment]);
  });
});
