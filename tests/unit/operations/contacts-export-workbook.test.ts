import { describe, expect, it, vi } from 'vitest';

// contacts-export.server → @/db 는 import 시 DATABASE_URL 검사 — 단위 테스트에서는 차단
vi.mock('@/db', () => ({ db: {} }));

import { buildContactsExportWorkbook } from '@/lib/operations/contacts-export.server';
import type { ContactExportRowData, ExportColumn } from '@/lib/operations/contacts-export';

const columns: ExportColumn[] = [
  { source: 'system.resid', label: '번호' },
  { source: 'attrs.회사명', label: '회사명' },
  { source: 'pii.이메일', label: '이메일' },
  { source: 'system.invite_url', label: '초대링크' },
];

const rows: ContactExportRowData[] = [
  {
    resid: 1,
    attrs: { 회사명: '메가리서치' },
    piiPlain: { 이메일: 'a@b.co' },
    latestResultCode: null,
    latestAttemptNo: null,
    latestMailStatus: null,
    progressPct: null,
    responseStatus: null,
    inviteCode: 'abc123',
  },
];

describe('buildContactsExportWorkbook', () => {
  it('헤더 행은 라벨, 데이터 행은 포맷된 값', () => {
    const wb = buildContactsExportWorkbook(columns, rows, 'https://s.example.com');
    const ws = wb.getWorksheet('조사 대상')!;
    expect(ws.getRow(1).values).toEqual([undefined, '번호', '회사명', '이메일', '초대링크']);
    expect(ws.getRow(2).values).toEqual([
      undefined,
      1,
      '메가리서치',
      'a@b.co',
      'https://s.example.com/i/abc123',
    ]);
  });
});
