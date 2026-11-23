import { describe, expect, it } from 'vitest';

import type { ContactColumnDef } from '@/shared/contracts/contacts';

import { normalizeContactColumnScheme } from './contacts-format';
import { extractSystemFieldKeys } from './contacts-shared';

function attrs(key: string, order: number, extra: Partial<ContactColumnDef> = {}): ContactColumnDef {
  return { key, label: key, source: `attrs.${key}`, order, ...extra } as ContactColumnDef;
}

function scheme(columns: ContactColumnDef[]) {
  const normalized = normalizeContactColumnScheme({ columns });
  if (!normalized) throw new Error('스킴 정규화 실패');
  return normalized;
}

describe('extractSystemFieldKeys — 조사 대상 저장이 그룹 값을 읽을 열', () => {
  // 2026-11-23 국내전시회 설문: 대분류는 Q0 인데 이름에 「전시회」가 든 「전시회ID」를 그룹으로 추측해,
  // 상세 화면에서 저장한 대상 314명의 그룹 값이 전시회ID 숫자로 덮였다.
  it('분류 기준이 있으면 대분류 열이다 — 이름에 「전시회」가 든 다른 열을 고르지 않는다', () => {
    const keys = extractSystemFieldKeys(
      scheme([
        attrs('전시회ID', 1),
        attrs('조사대상', 2),
        attrs('Q0', 3, { groupLevel: 1 }),
        attrs('Q0_1', 4, { groupLevel: 2 }),
      ]),
    );
    expect(keys).toEqual({ group: 'Q0' });
  });

  it('레벨이 여럿이면 가장 높은 분류(대분류)다 — 열 순서와 무관하다', () => {
    const keys = extractSystemFieldKeys(
      scheme([attrs('종사자 구간', 1, { groupLevel: 2 }), attrs('산업 분류', 2, { groupLevel: 1 })]),
    );
    expect(keys).toEqual({ group: '산업 분류' });
  });

  it('옛 저장분의 분류 토글(groupBy)도 분류 기준이다', () => {
    const keys = extractSystemFieldKeys(
      scheme([attrs('전시회ID', 1), attrs('지역', 2, { groupBy: true })]),
    );
    expect(keys).toEqual({ group: '지역' });
  });

  it('분류 기준이 없는 옛 설문은 종전대로 이름으로 찾는다', () => {
    // 해외전시회 설문 — 분류 기준 설정 없이 「전시회명(국문)」이 업로드 때의 그룹 열이다.
    const keys = extractSystemFieldKeys(scheme([attrs('업체명', 1), attrs('전시회명(국문)', 2)]));
    expect(keys).toEqual({ group: '전시회명(국문)' });
  });

  it('분류 기준도 없고 이름으로도 못 찾으면 비운다 — 저장이 그룹 값을 건드리지 않는다', () => {
    expect(extractSystemFieldKeys(scheme([attrs('업체명', 1), attrs('지역', 2)]))).toEqual({});
  });
});
