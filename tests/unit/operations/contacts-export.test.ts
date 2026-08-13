import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';
import {
  buildDownloadCandidates,
  INVITE_URL_SOURCE,
  resolveExportColumns,
  formatExportCell,
  type ContactExportRowData,
} from '@/lib/operations/contacts-export';

function makeScheme(): ContactColumnScheme {
  return {
    version: 1,
    headerRow: 1,
    columns: [
      { key: 'resid', label: '번호', source: 'system.resid', order: 0 },
      { key: 'contact_result', label: '컨택결과', source: 'system.contact_result', order: 1 },
      { key: 'email_count', label: '메일', source: 'system.email_count', order: 2 },
      { key: 'web', label: 'web', source: 'system.web', order: 3 },
      { key: 'contact_owner', label: '면접원', source: 'system.contact_owner', order: 4 },
      { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 5 },
      { key: '비고', label: '비고', source: 'attrs.비고', order: 6, hidden: true },
      { key: '이메일', label: '이메일', source: 'pii.이메일', order: 7, piiType: 'email' },
    ],
  };
}

describe('buildDownloadCandidates', () => {
  it('스킴 순서 유지 + hidden 포함 + contact_owner 제외 + 초대링크 끝에 추가', () => {
    const candidates = buildDownloadCandidates(makeScheme());
    expect(candidates.map((c) => c.source)).toEqual([
      'system.resid',
      'system.contact_result',
      'system.email_count',
      'system.web',
      'attrs.회사명',
      'attrs.비고',
      'pii.이메일',
      INVITE_URL_SOURCE,
    ]);
  });

  it('기본 체크는 non-hidden 스킴 컬럼만, 초대링크는 미체크', () => {
    const candidates = buildDownloadCandidates(makeScheme());
    const bySource = new Map(candidates.map((c) => [c.source, c.defaultChecked]));
    expect(bySource.get('attrs.회사명')).toBe(true);
    expect(bySource.get('attrs.비고')).toBe(false);
    expect(bySource.get(INVITE_URL_SOURCE)).toBe(false);
  });

  it('스킴에 없는 시스템 특수 컬럼은 폴백 라벨로 뒤에 추가된다', () => {
    const scheme: ContactColumnScheme = {
      version: 1,
      headerRow: 1,
      columns: [{ key: 'resid', label: '번호', source: 'system.resid', order: 0 }],
    };
    const candidates = buildDownloadCandidates(scheme);
    expect(candidates.map((c) => c.source)).toEqual([
      'system.resid',
      'system.contact_result',
      'system.email_count',
      'system.web',
      INVITE_URL_SOURCE,
    ]);
    const invite = candidates.find((c) => c.source === INVITE_URL_SOURCE);
    expect(invite?.label).toBe('초대링크');
    expect(invite?.defaultChecked).toBe(false);
  });
});

describe('resolveExportColumns', () => {
  it('화이트리스트 매칭 컬럼만 라벨과 함께 반환하고 순서는 요청 순서를 따른다', () => {
    const cols = resolveExportColumns(
      ['attrs.회사명', INVITE_URL_SOURCE, 'system.resid'],
      makeScheme(),
    );
    expect(cols).toEqual([
      { source: 'attrs.회사명', label: '회사명' },
      { source: INVITE_URL_SOURCE, label: '초대링크' },
      { source: 'system.resid', label: '번호' },
    ]);
  });

  it('스킴에 없는 source·contact_owner·중복은 무시한다', () => {
    const cols = resolveExportColumns(
      ['attrs.없는키', 'system.contact_owner', 'system.resid', 'system.resid'],
      makeScheme(),
    );
    expect(cols).toEqual([{ source: 'system.resid', label: '번호' }]);
  });

  it('빈 입력이면 빈 배열', () => {
    expect(resolveExportColumns([], makeScheme())).toEqual([]);
  });
});

function makeRow(overrides: Partial<ContactExportRowData> = {}): ContactExportRowData {
  return {
    resid: 7,
    attrs: { 회사명: '메가리서치' },
    piiPlain: { 이메일: 'a@b.co' },
    latestResultCode: null,
    latestAttemptNo: null,
    latestMailStatus: null,
    progressPct: null,
    inviteCode: 'abc123',
    ...overrides,
  };
}

describe('formatExportCell', () => {
  const base = 'https://s.example.com';

  it('system.resid 는 숫자 그대로', () => {
    expect(formatExportCell('system.resid', makeRow(), base)).toBe(7);
  });

  it('attrs 는 키 값, 없으면 빈 문자열', () => {
    expect(formatExportCell('attrs.회사명', makeRow(), base)).toBe('메가리서치');
    expect(formatExportCell('attrs.없음', makeRow(), base)).toBe('');
  });

  it('pii 는 복호화 평문, 없으면 빈 문자열', () => {
    expect(formatExportCell('pii.이메일', makeRow(), base)).toBe('a@b.co');
    expect(formatExportCell('pii.전화', makeRow(), base)).toBe('');
  });

  it('회차결과는 [회차] 코드 형태, 없으면 빈 문자열', () => {
    const row = makeRow({ latestResultCode: '부재', latestAttemptNo: 2 });
    expect(formatExportCell('system.contact_result', row, base)).toBe('[2] 부재');
    expect(formatExportCell('system.contact_result', makeRow(), base)).toBe('');
  });

  it('메일 상태는 한국어 라벨, 없으면 빈 문자열', () => {
    const row = makeRow({ latestMailStatus: 'delivered' });
    expect(formatExportCell('system.email_count', row, base)).toBe('전달 완료');
    expect(formatExportCell('system.email_count', makeRow(), base)).toBe('');
  });

  it('진행율은 NN% 형태이고 0도 표기, 없으면 빈 문자열', () => {
    expect(formatExportCell('system.web', makeRow({ progressPct: 45 }), base)).toBe('45%');
    expect(formatExportCell('system.web', makeRow({ progressPct: 0 }), base)).toBe('0%');
    expect(formatExportCell('system.web', makeRow(), base)).toBe('');
  });

  it('초대링크는 baseUrl/i/inviteCode', () => {
    expect(formatExportCell('system.invite_url', makeRow(), base)).toBe(
      'https://s.example.com/i/abc123',
    );
  });
});
