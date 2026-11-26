import { describe, expect, it } from 'vitest';

import type { ProfileColumnDef } from '@/shared/contracts/operations';
import type { ProfilesRow } from '@/shared/contracts/operations-io';

import { buildResponseListTable } from './response-list-sheet';

const col = (key: string, label: string, order: number): ProfileColumnDef =>
  ({ key, label, order }) as ProfileColumnDef;

function row(over: Partial<ProfilesRow>): ProfilesRow {
  return {
    id: 'r1',
    idx: 1,
    platform: 'mobile',
    browser: 'Chrome',
    status: 'completed',
    currentStepId: null,
    visibleStepIndex: null,
    visibleStepTotal: null,
    startedAt: new Date('2026-11-15T09:07:00Z'),
    completedAt: new Date('2026-11-15T09:09:00Z'),
    totalSeconds: 120,
    groupValue: null,
    resid: null,
    attrs: null,
    contactTargetId: null,
    ipHash: null,
    entryParams: null,
    isTest: false,
    ...over,
  } as ProfilesRow;
}

// 고객 계정이 보는 응답 내역 화면의 열 — 순번·유저ID·기업명·접속 단말·상태·시작·종료·소요시간
const COLUMNS = [
  col('sys.idx', '순번', 0),
  col('entry.euid', '유저ID', 1),
  col('answer.q1.c-name', '기업명', 2),
  col('sys.platform', '접속 단말', 3),
  col('sys.status', '상태', 4),
  col('sys.startedAt', '시작일시', 5),
  col('sys.completedAt', '종료일시', 6),
  col('sys.totalSeconds', '소요시간', 7),
];

describe('buildResponseListTable', () => {
  it('화면에 보이는 열 순서 그대로 내고, 상태 뒤에 마지막 응답 문항을 붙인다', () => {
    const table = buildResponseListTable({
      columns: COLUMNS,
      rows: [
        row({
          id: 'r2',
          idx: 220,
          status: 'drop',
          currentStepId: 'group:g3',
          entryParams: { euid: 'cab2070f-1111' },
          totalSeconds: null,
        }),
        row({ id: 'r1', idx: 33, entryParams: { euid: 'aaaa-2222' } }),
        row({
          id: 'r3',
          idx: 224,
          status: 'in_progress',
          currentStepId: 'group:g1',
          completedAt: null,
          totalSeconds: null,
        }),
      ],
      stepLocations: {
        'group:g3': { order: 9, qNumber: 'Q3' },
        'group:g1': { order: 0, qNumber: null },
      },
      hasContacts: false,
      piiByTarget: {},
      answerValues: { r2: { 'answer.q1.c-name': '현대오토에버' } },
    });

    expect(table.headers).toEqual([
      '순번',
      '유저ID',
      '기업명',
      '접속 단말',
      '상태',
      '마지막 응답 문항',
      '시작일시',
      '종료일시',
      '소요시간',
    ]);
    // 유저ID 는 화면처럼 줄이지 않고 전체를 싣는다. 날짜는 한국 시각.
    expect(table.rows[0]).toEqual([
      220,
      'cab2070f-1111',
      '현대오토에버',
      '모바일',
      '이탈',
      'Q3',
      '2026-11-15 18:07',
      '2026-11-15 18:09',
      '—',
    ]);
    // 완료 응답은 마지막 응답 문항이 비고, 값 없는 응답값 칸도 빈칸이다
    expect(table.rows[1]).toEqual([
      33,
      'aaaa-2222',
      '',
      '모바일',
      '완료',
      '',
      '2026-11-15 18:07',
      '2026-11-15 18:09',
      '2분',
    ]);
    // 진행 중 — 쪽의 대표 문항을 못 읽으면 빈칸
    expect(table.rows[2]?.slice(4, 9)).toEqual(['진행중', '', '2026-11-15 18:07', '진행 중', '진행 중']);
  });

  it('명단 열·개인정보 열·시스템ID 는 화면과 같은 규칙이다 — 조사 대상이 없으면 시스템ID 열이 없다', () => {
    const columns = [
      col('sys.resid', '시스템ID', 0),
      col('attrs.업체명', '업체명', 1),
      col('pii.담당자', '담당자', 2),
      col('sys.unknown', '모르는 열', 3),
    ];
    const rows = [
      row({ resid: 7, attrs: { 업체명: '메가유업' }, contactTargetId: 't1' }),
      row({ id: 'r9' }),
    ];
    const input = {
      rows,
      stepLocations: {},
      piiByTarget: { t1: { 담당자: '홍길*' } },
      answerValues: {},
    };
    expect(buildResponseListTable({ ...input, columns, hasContacts: true })).toEqual({
      headers: ['시스템ID', '업체명', '담당자'],
      rows: [
        [7, '메가유업', '홍길*'],
        ['', '', ''],
      ],
    });
    expect(buildResponseListTable({ ...input, columns, hasContacts: false }).headers).toEqual([
      '업체명',
      '담당자',
    ]);
  });

  it('그룹 칸은 조사 대상과 이어진 응답이면 그룹 값이 없어도 공개링크로 적지 않는다', () => {
    const table = buildResponseListTable({
      columns: [col('sys.group', '조사 대상 그룹', 0)],
      rows: [
        row({ id: 'r1', groupValue: '서울', contactTargetId: 'ct-1' }),
        row({ id: 'r2', groupValue: null, contactTargetId: 'ct-2' }),
        row({ id: 'r3', groupValue: null, contactTargetId: null }),
      ],
      stepLocations: {},
      hasContacts: true,
      piiByTarget: {},
      answerValues: {},
    });
    expect(table.rows).toEqual([['서울'], [''], ['공개링크']]);
  });

  it('응답 경로 열은 개별링크·공개링크로 내고, 조사 대상이 없는 설문에서는 열을 내지 않는다', () => {
    const input = {
      columns: [col('sys.idx', '순번', 0), col('sys.linkType', '응답 경로', 1)],
      rows: [
        row({ id: 'r1', idx: 1, contactTargetId: 'ct-1' }),
        row({ id: 'r2', idx: 2, contactTargetId: null }),
      ],
      stepLocations: {},
      piiByTarget: {},
      answerValues: {},
    };
    const withContacts = buildResponseListTable({ ...input, hasContacts: true });
    expect(withContacts.headers).toEqual(['순번', '응답 경로']);
    expect(withContacts.rows).toEqual([
      [1, '개별링크'],
      [2, '공개링크'],
    ]);
    expect(buildResponseListTable({ ...input, hasContacts: false }).headers).toEqual(['순번']);
  });
});
