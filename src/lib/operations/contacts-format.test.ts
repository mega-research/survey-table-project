import { describe, expect, it } from 'vitest';
import {
  CONTACTS_SORT_KEYS,
  CONTACTS_QFIELDS,
  CONTACTS_PAGE_SIZE,
  maskEmail,
  attrsKeyOf,
  normalizeContactColumnScheme,
  residColumnLabel,
  visiblePiiColumnKeys,
  withLinkClickColumn,
} from '@/lib/operations/contacts-format';
import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

// normalizeContactListArgs / hasActiveContactFilters 테스트는 함수 제거와 함께 삭제됨
// (다중 조건 필터 모델로 전환 — page.tsx 가 인라인으로 page/sort/dir 파싱).

describe('maskEmail', () => {
  it('일반 이메일', () => {
    expect(maskEmail('hong.gildong@example.com')).toBe('ho***@***.com');
  });
  it('한 글자 로컬', () => {
    expect(maskEmail('a@example.com')).toBe('a***@***.com');
  });
  it('null/빈 문자 → "—"', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail('')).toBe('—');
  });
  it('@ 없는 잘못된 입력 → "—"', () => {
    expect(maskEmail('not-an-email')).toBe('—');
  });
});

describe('whitelist exports', () => {
  it('CONTACTS_SORT_KEYS contains resid + respondedAt', () => {
    expect(CONTACTS_SORT_KEYS).toContain('resid');
    expect(CONTACTS_SORT_KEYS).toContain('respondedAt');
  });
  it("web 컬럼 정렬용 'webActivity' 키 — 매칭 응답 활동 시각 기준 (respondedAt 만으론 미완료 행이 정렬 안 됨)", () => {
    expect(CONTACTS_SORT_KEYS).toContain('webActivity');
  });
  it("메일 컬럼 정렬용 'mailStatus' 키 — 최신 수신 상태 순위 기준", () => {
    expect(CONTACTS_SORT_KEYS).toContain('mailStatus');
  });
  it('CONTACTS_PAGE_SIZE = 20', () => {
    expect(CONTACTS_PAGE_SIZE).toBe(20);
  });
  it('CONTACTS_QFIELDS contains all/resid/email/group', () => {
    expect(CONTACTS_QFIELDS).toEqual(expect.arrayContaining(['all', 'resid', 'email', 'group']));
  });
});

describe('attrsKeyOf', () => {
  it("'attrs.전시회명' → '전시회명'", () => {
    expect(attrsKeyOf('attrs.전시회명')).toBe('전시회명');
  });
  it("'system.resid' → null", () => {
    expect(attrsKeyOf('system.resid')).toBeNull();
  });
  it("빈 문자열 → null", () => {
    expect(attrsKeyOf('')).toBeNull();
  });
});

describe('visiblePiiColumnKeys', () => {
  it('표시 중인 개인정보 열의 키만 낸다 — 숨긴 열·attrs·시스템 열은 뺀다', () => {
    expect(
      visiblePiiColumnKeys({
        version: 1,
        headerRow: 1,
        columns: [
          { key: 'resid', label: 'ID', source: 'system.resid', order: 1 },
          { key: '업소명', label: '업소명', source: 'attrs.업소명', order: 2 },
          { key: '대표자', label: '대표자', source: 'pii.대표자', order: 3 },
          { key: '이메일', label: '이메일', source: 'pii.이메일', order: 4, hidden: true },
          { key: '전화번호', label: '전화번호', source: 'pii.전화번호', order: 5 },
        ],
      }),
    ).toEqual(['대표자', '전화번호']);
  });

  it('스킴이 없으면 빈 배열', () => {
    expect(visiblePiiColumnKeys(null)).toEqual([]);
  });
});

describe('residColumnLabel', () => {
  it('컬럼 설정에서 고친 시스템ID 라벨을 쓴다', () => {
    expect(
      residColumnLabel({
        columns: [
          { key: 'resid', label: ' 관리번호 ', source: 'system.resid', order: 1 },
          { key: 'resid', label: 'resid', source: 'attrs.resid', order: 2 },
        ],
      }),
    ).toBe('관리번호');
  });

  it('라벨이 비었거나 스킴이 없으면 기본 라벨이다 — 명단의 resid 열 이름을 쓰지 않는다', () => {
    expect(
      residColumnLabel({
        columns: [
          { key: 'resid', label: '', source: 'system.resid', order: 1 },
          { key: 'resid', label: 'resid', source: 'attrs.resid', order: 2 },
        ],
      }),
    ).toBe('시스템ID');
    expect(residColumnLabel(null)).toBe('시스템ID');
  });
});

describe('withLinkClickColumn — 「링크 클릭」 열 읽기 보정', () => {
  const col = (key: string, source: ContactColumnDef['source'], order: number): ContactColumnDef => ({
    key,
    label: key,
    source,
    order,
  });
  const scheme = (columns: ContactColumnDef[]): ContactColumnScheme => ({
    version: 1,
    headerRow: 1,
    columns,
  });
  const sources = (s: ContactColumnScheme) =>
    [...s.columns].sort((a, b) => a.order - b.order).map((c) => c.source);

  it('「메일」 열 바로 뒤에 끼우고 순서 번호를 다시 매긴다', () => {
    const out = withLinkClickColumn(
      scheme([
        col('resid', 'system.resid', 1),
        col('회사명', 'attrs.회사명', 2),
        col('email_count', 'system.email_count', 3),
        col('web', 'system.web', 4),
      ]),
    );

    expect(sources(out)).toEqual([
      'system.resid',
      'attrs.회사명',
      'system.email_count',
      'system.link_click',
      'system.web',
    ]);
    expect(out.columns.map((c) => c.order)).toEqual([1, 2, 3, 4, 5]);
    expect(out.columns.find((c) => c.source === 'system.link_click')).toMatchObject({
      key: 'link_click',
      label: '링크 클릭',
    });
  });

  it('배열 순서와 order 가 어긋난 스킴도 order 기준 「메일」 뒤에 선다', () => {
    const out = withLinkClickColumn(
      scheme([
        col('web', 'system.web', 3),
        col('email_count', 'system.email_count', 2),
        col('resid', 'system.resid', 1),
      ]),
    );

    expect(sources(out)).toEqual([
      'system.resid',
      'system.email_count',
      'system.link_click',
      'system.web',
    ]);
  });

  it('이미 있으면 같은 객체를 그대로 돌려준다 — 숨김 설정도 그대로', () => {
    const input = scheme([
      col('email_count', 'system.email_count', 1),
      { ...col('link_click', 'system.link_click', 2), hidden: true },
    ]);

    expect(withLinkClickColumn(input)).toBe(input);
  });

  it('「메일」 열이 없는 스킴은 건드리지 않는다', () => {
    const input = scheme([col('resid', 'system.resid', 1)]);

    expect(withLinkClickColumn(input)).toBe(input);
  });

  it('두 번 보정해도 같다', () => {
    const once = withLinkClickColumn(scheme([col('email_count', 'system.email_count', 1)]));

    expect(withLinkClickColumn(once)).toBe(once);
  });

  it('스킴을 읽는 정규화가 이 보정을 거친다', () => {
    const out = normalizeContactColumnScheme(scheme([col('email_count', 'system.email_count', 1)]));

    expect(out?.columns.map((c) => c.source)).toEqual(['system.email_count', 'system.link_click']);
  });
});
