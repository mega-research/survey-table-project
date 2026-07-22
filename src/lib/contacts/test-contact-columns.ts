import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';

type ContactColumnSchemeInput = Omit<ContactColumnScheme, 'columns'> & {
  readonly columns: readonly ContactColumnDef[];
};

const DEFAULTS: readonly ContactColumnDef[] = [
  { key: 'test_name', label: '이름', source: 'pii.test_name', piiType: 'name', order: 0 },
  { key: 'test_company', label: '회사', source: 'attrs.test_company', order: 0 },
  {
    key: 'test_phone',
    label: '전화번호',
    source: 'pii.test_phone',
    piiType: 'phone',
    order: 0,
  },
  {
    key: 'test_email',
    label: '이메일',
    source: 'pii.test_email',
    piiType: 'email',
    order: 0,
  },
];

function isCompanyAttrsColumn(column: ContactColumnDef): boolean {
  return (
    column.source.startsWith('attrs.') &&
    /회사|기업|company/i.test(`${column.key} ${column.label}`)
  );
}

export function ensureTestContactColumns(
  real: ContactColumnSchemeInput | null,
  saved: ContactColumnSchemeInput | null,
): ContactColumnScheme {
  if (saved) return structuredClone(saved) as ContactColumnScheme;

  const base = structuredClone(
    real ?? { version: 1, headerRow: 1, columns: [] },
  ) as ContactColumnScheme;
  const hasCompany = base.columns.some(isCompanyAttrsColumn);
  const missing = DEFAULTS.filter((column) => {
    if (column.piiType === 'name') {
      return !base.columns.some(
        (candidate) => candidate.piiType === 'name' || candidate.piiType === 'representative',
      );
    }
    if (column.piiType === 'phone') {
      return !base.columns.some(
        (candidate) => candidate.piiType === 'phone' || candidate.piiType === 'mobile',
      );
    }
    if (column.piiType === 'email') {
      return !base.columns.some((candidate) => candidate.piiType === 'email');
    }
    return !hasCompany;
  });

  const columns = [...base.columns, ...missing].map((column, index) => ({
    ...column,
    order: index + 1,
  }));
  return { ...base, columns };
}

export interface TestContactFieldBindings {
  name: { columnKey: string; fieldType: 'name' | 'representative' };
  company: { columnKey: string };
  phone: { columnKey: string; fieldType: 'phone' | 'mobile' };
  email: { columnKey: string; fieldType: 'email' };
}

export function resolveTestContactFieldBindings(
  scheme: ContactColumnScheme,
): TestContactFieldBindings {
  const name = scheme.columns.find(
    (column) => column.piiType === 'name' || column.piiType === 'representative',
  );
  const company = scheme.columns.find(isCompanyAttrsColumn);
  const phone = scheme.columns.find(
    (column) => column.piiType === 'phone' || column.piiType === 'mobile',
  );
  const email = scheme.columns.find((column) => column.piiType === 'email');

  if (!name || (name.piiType !== 'name' && name.piiType !== 'representative')) {
    throw new Error('테스트 이름 컬럼을 찾을 수 없습니다.');
  }
  if (!company) throw new Error('테스트 회사 컬럼을 찾을 수 없습니다.');
  if (!phone || (phone.piiType !== 'phone' && phone.piiType !== 'mobile')) {
    throw new Error('테스트 전화 컬럼을 찾을 수 없습니다.');
  }
  if (!email || email.piiType !== 'email') {
    throw new Error('테스트 이메일 컬럼을 찾을 수 없습니다.');
  }

  return {
    name: { columnKey: name.source.slice(4), fieldType: name.piiType },
    company: { columnKey: company.source.slice(6) },
    phone: { columnKey: phone.source.slice(4), fieldType: phone.piiType },
    email: { columnKey: email.source.slice(4), fieldType: email.piiType },
  };
}
