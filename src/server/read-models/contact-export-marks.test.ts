import { describe, expect, it } from 'vitest';

import type { ContactTargetEditChange } from '@/shared/contracts/contacts';

import { resolveEditedSources } from './contact-export-marks';

const attr = (key: string, before: string, after: string): ContactTargetEditChange => ({
  kind: 'attr',
  key,
  label: key,
  before,
  after,
});

describe('resolveEditedSources — 원본과 달라진 명단 열', () => {
  it('일반 열은 처음 고치기 전 값과 지금 값이 다를 때만 고친 칸이다', () => {
    const sources = resolveEditedSources({
      attrs: { 기업명: '아리오나트', 지원연도: '2022' },
      changes: [attr('기업명', '-', '아리오나트'), attr('지원연도', '2022', '2023'), attr('지원연도', '2023', '2022')],
    });
    // 지원연도는 고쳤다가 원래대로 돌려놓아 원본과 같다
    expect([...sources]).toEqual(['attrs.기업명']);
  });

  it('여러 번 고쳐도 기준은 첫 기록의 이전 값이다', () => {
    const sources = resolveEditedSources({
      attrs: { 기업명: 'B' },
      changes: [attr('기업명', '', 'A'), attr('기업명', 'A', 'B')],
    });
    expect([...sources]).toEqual(['attrs.기업명']);
  });

  it('개인정보 열은 값이 기록에 없어 입력·변경·삭제가 한 번이라도 있으면 고친 칸이다', () => {
    const sources = resolveEditedSources({
      attrs: {},
      changes: [
        { kind: 'pii', key: '대표번호', label: '대표번호', op: 'set' },
        { kind: 'memo', before: '', after: '메모' },
        { kind: 'contactMethod', before: '', after: 'phone' },
      ],
    });
    expect([...sources]).toEqual(['pii.대표번호']);
  });

  it('지금 attrs 에 없는 열은 빈 값으로 본다 — 지운 칸은 고친 칸, 비었다 다시 빈 칸은 아니다', () => {
    expect([...resolveEditedSources({ attrs: {}, changes: [attr('홈페이지', 'a.com', '')] })]).toEqual([
      'attrs.홈페이지',
    ]);
    expect([
      ...resolveEditedSources({ attrs: {}, changes: [attr('홈페이지', '', 'a.com'), attr('홈페이지', 'a.com', '')] }),
    ]).toEqual([]);
  });
});
