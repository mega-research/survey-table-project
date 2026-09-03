import { describe, expect, it } from 'vitest';
import {
  CONTACTS_SORT_KEYS,
  CONTACTS_QFIELDS,
  CONTACTS_PAGE_SIZE,
  maskEmail,
  maskPhone,
  maskBizNumber,
  attrsKeyOf,
  normalizeContactColumnScheme,
  selectRawExportContactColumns,
} from '@/lib/operations/contacts';
import type { ContactColumnScheme } from '@/db/schema/schema-types';

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

describe('maskPhone', () => {
  it('010 11자리', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });
  it('010 하이픈 포함', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });
  it('숫자 4자 미만 → "—"', () => {
    expect(maskPhone('123')).toBe('—');
  });
  it('null → "—"', () => {
    expect(maskPhone(null)).toBe('—');
  });
});

describe('maskBizNumber', () => {
  it('10자리 사업자번호', () => {
    expect(maskBizNumber('1234567890')).toBe('123-**-*7890');
  });
  it('하이픈 포함 정규화', () => {
    expect(maskBizNumber('123-45-67890')).toBe('123-**-*7890');
  });
  it('자리수 부족 → "—"', () => {
    expect(maskBizNumber('123')).toBe('—');
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

describe('selectRawExportContactColumns', () => {
  // 운영 명단 모양 — system 열 사이에 pii·attrs 가 섞여 있고 2025 열은 콘솔 숨김이다.
  const scheme: ContactColumnScheme = {
    version: 1,
    headerRow: 1,
    columns: [
      { key: 'resid', label: '시스템ID', source: 'system.resid', order: 0 },
      { key: 'web', label: '응답 상태', source: 'system.web', order: 1 },
      { key: '성명', label: '성명', source: 'pii.성명', order: 2, hidden: true, piiType: 'name' },
      { key: '2025_상태', label: '2025_상태', source: 'attrs.2025_상태', order: 3, hidden: true },
      { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 4 },
      { key: '기수', label: '', source: 'attrs.기수', order: 5 },
    ],
  };

  it('attrs·pii 열 전부를 order 순으로 고르고 system 열은 뺀다 — 숨김 열 포함', () => {
    expect(selectRawExportContactColumns(scheme)).toEqual([
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
      { source: 'attrs.2025_상태', label: '2025_상태', kind: 'attrs', key: '2025_상태' },
      { source: 'attrs.기업명', label: '기업명', kind: 'attrs', key: '기업명' },
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
    ]);
  });

  it('저장 순서가 뒤섞여 있어도 order 오름차순이다', () => {
    const shuffled: ContactColumnScheme = {
      ...scheme,
      columns: [...scheme.columns].reverse(),
    };
    expect(selectRawExportContactColumns(shuffled).map((c) => c.source)).toEqual([
      'pii.성명',
      'attrs.2025_상태',
      'attrs.기업명',
      'attrs.기수',
    ]);
  });

  it('스킴이 없거나 columns 가 없으면 빈 배열이다', () => {
    expect(selectRawExportContactColumns(null)).toEqual([]);
    expect(
      selectRawExportContactColumns(normalizeContactColumnScheme({ version: 1, headerRow: 1 })),
    ).toEqual([]);
  });

  it('system.contact_owner·email_count·contact_result 도 전부 제외한다', () => {
    const systemOnly: ContactColumnScheme = {
      version: 1,
      headerRow: 1,
      columns: [
        { key: 'contact_owner', label: '담당자', source: 'system.contact_owner', order: 0 },
        { key: 'email_count', label: '메일', source: 'system.email_count', order: 1 },
        { key: 'contact_result', label: '컨택결과', source: 'system.contact_result', order: 2 },
      ],
    };
    expect(selectRawExportContactColumns(systemOnly)).toEqual([]);
  });
});
