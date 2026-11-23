import { describe, expect, it } from 'vitest';

import { RECIPIENT_FILTER_SOURCE } from '@/lib/operations/filter-shared';

import { splitRecipientHeaderEntries } from './recipient-header-filters';

describe('splitRecipientHeaderEntries — 발송 회차 수신자 표가 받는 열 머리 조건', () => {
  it('메모·최근 결과코드의 체크박스 조건만 받는다', () => {
    const r = splitRecipientHeaderEntries([
      { source: RECIPIENT_FILTER_SOURCE.ERROR, mode: 'in', hv: 'hard bounce' },
      { source: RECIPIENT_FILTER_SOURCE.RESULT, mode: 'in', hv: '1.조사완료' },
    ]);
    expect(r.accepted).toHaveLength(2);
    expect(r.droppedCount).toBe(0);
  });

  // 그룹 칸을 빼기 전에 저장해 둔 주소(hcol=recipient.group)로 들어오면 그 조건이 빠져 명단이 넓어진다.
  // 조용히 넓히지 않고 몇 개가 빠졌는지 알려 화면이 경고하게 한다.
  it('없어진 그룹 조건은 빼고 빠진 수를 알린다', () => {
    const r = splitRecipientHeaderEntries([
      { source: 'recipient.group', mode: 'in', hv: '모바일' },
      { source: RECIPIENT_FILTER_SOURCE.ERROR, mode: 'in', hv: 'hard bounce' },
    ]);
    expect(r.accepted.map((e) => e.source)).toEqual([RECIPIENT_FILTER_SOURCE.ERROR]);
    expect(r.droppedCount).toBe(1);
  });

  it('이 표가 모르는 열·모드도 빠진 조건으로 센다', () => {
    const r = splitRecipientHeaderEntries([
      { source: 'attrs.지역', mode: 'in', hv: '서울' },
      { source: RECIPIENT_FILTER_SOURCE.RESULT, mode: 'text', hv: '완료' },
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.droppedCount).toBe(2);
  });
});
