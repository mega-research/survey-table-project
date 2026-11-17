import { describe, expect, it } from 'vitest';
import {
  CONTACTS_SORT_KEYS,
  CONTACTS_QFIELDS,
  CONTACTS_PAGE_SIZE,
  maskEmail,
  attrsKeyOf,
  residColumnLabel,
  visiblePiiColumnKeys,
} from '@/lib/operations/contacts-format';

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
