import { describe, expect, it } from 'vitest';

import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';

import {
  CLIENT_RESPONSE_SYS_KEYS,
  buildClientResponseColumnCandidates,
  clientResponseColumnSources,
  isClientResponseColumnAllowed,
  resolveClientResponseColumnKeys,
} from './client-response-columns-format';

const contactScheme = normalizeContactColumnScheme({
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '번호', source: 'system.resid', order: 0 },
    { key: '업체명', label: '업체명', source: 'attrs.업체명', order: 2 },
    { key: '지역', label: '지역', source: 'attrs.지역', order: 1 },
    { key: '담당자', label: '담당자', source: 'pii.담당자', order: 3 },
    { key: '연락처', label: '연락처', source: 'attrs.연락처', order: 4, piiType: 'phone' },
  ],
})!;

const answerSources: ProfileAnswerSource[] = [
  { key: 'answer.q1', varName: 'Q1', questionTitle: '기업명', cellLabel: null, encrypted: false },
  { key: 'answer.q2', varName: 'Q2', questionTitle: '대표자 성명', cellLabel: null, encrypted: true },
  {
    key: 'answer.q3.c1',
    varName: 'Q3_r1_c2',
    questionTitle: '매출',
    cellLabel: '(1) 2025년',
    encrypted: false,
  },
];

const sources = clientResponseColumnSources({
  contactScheme,
  entryParamNames: ['euid'],
  answerSources,
});

describe('isClientResponseColumnAllowed', () => {
  it('시스템 열은 IP 해시만 빼고 연다', () => {
    for (const key of CLIENT_RESPONSE_SYS_KEYS) {
      expect(isClientResponseColumnAllowed(key, sources)).toBe(true);
    }
    expect(CLIENT_RESPONSE_SYS_KEYS).not.toContain('sys.ipHash');
    expect(isClientResponseColumnAllowed('sys.ipHash', sources)).toBe(false);
    expect(isClientResponseColumnAllowed('sys.없는열', sources)).toBe(false);
  });

  it('이어 넘길 값은 지금 설정된 이름만 연다', () => {
    expect(isClientResponseColumnAllowed('entry.euid', sources)).toBe(true);
    expect(isClientResponseColumnAllowed('entry.uid', sources)).toBe(false);
  });

  it('명단 열은 개인정보로 매핑하지 않은 attrs 만 연다 — pii 는 마스킹본도 없다', () => {
    expect(isClientResponseColumnAllowed('attrs.업체명', sources)).toBe(true);
    expect(isClientResponseColumnAllowed('attrs.없는열', sources)).toBe(false);
    expect(isClientResponseColumnAllowed('pii.담당자', sources)).toBe(false);
    // attrs 자리에 개인정보 유형이 붙은 열도 닫는다 — 넓어지는 쪽으로 틀리지 않게.
    expect(isClientResponseColumnAllowed('attrs.연락처', sources)).toBe(false);
  });

  it('응답값 열은 평문 칸만 연다 — 암호화 저장 칸과 없는 칸은 닫는다', () => {
    expect(isClientResponseColumnAllowed('answer.q1', sources)).toBe(true);
    expect(isClientResponseColumnAllowed('answer.q3.c1', sources)).toBe(true);
    expect(isClientResponseColumnAllowed('answer.q2', sources)).toBe(false);
    expect(isClientResponseColumnAllowed('answer.q9', sources)).toBe(false);
  });

  it('모르는 접두는 닫혀 있다', () => {
    expect(isClientResponseColumnAllowed('system.contact_owner', sources)).toBe(false);
    expect(isClientResponseColumnAllowed('', sources)).toBe(false);
  });
});

describe('resolveClientResponseColumnKeys', () => {
  it('허용 밖·지금 없는 키를 버리고 버린 것을 돌려준다 — 순번은 맨 앞이다', () => {
    expect(
      resolveClientResponseColumnKeys(
        ['entry.euid', 'pii.담당자', 'sys.idx', 'answer.q2', 'sys.status', 'answer.q9'],
        sources,
      ),
    ).toEqual({
      keys: ['sys.idx', 'entry.euid', 'sys.status'],
      dropped: ['pii.담당자', 'answer.q2', 'answer.q9'],
    });
  });

  it('순번이 저장에 없어도 맨 앞에 선다', () => {
    expect(resolveClientResponseColumnKeys(['sys.status'], sources).keys).toEqual([
      'sys.idx',
      'sys.status',
    ]);
  });
});

describe('buildClientResponseColumnCandidates', () => {
  it('시스템 → 이어 넘길 값 → 명단(명단 순서) → 응답값 순이고 닫힌 열은 후보에 없다', () => {
    const candidates = buildClientResponseColumnCandidates({
      contactScheme,
      profileScheme: null,
      entryParamNames: ['euid'],
      answerSources,
      hasContacts: true,
    });
    const keys = candidates.map((c) => c.key);
    expect(keys).toEqual([
      ...CLIENT_RESPONSE_SYS_KEYS,
      'entry.euid',
      'attrs.지역',
      'attrs.업체명',
      'answer.q1',
      'answer.q3.c1',
    ]);
    expect(keys).not.toContain('sys.ipHash');
    expect(keys).not.toContain('pii.담당자');
    expect(keys).not.toContain('answer.q2');
  });

  it('라벨은 내부 응답 내역의 이름을 따르고, 내부에 없는 응답값 열은 칸 이름 → 제목 순이다', () => {
    const candidates = buildClientResponseColumnCandidates({
      contactScheme,
      profileScheme: {
        version: 1,
        columns: [
          { key: 'sys.status', label: '진행 상태', order: 0 },
          { key: 'answer.q1', label: '응답 기업명', order: 1 },
        ],
      },
      entryParamNames: ['euid'],
      answerSources,
      hasContacts: true,
    });
    const label = (key: string) => candidates.find((c) => c.key === key)?.label;
    expect(label('sys.status')).toBe('진행 상태');
    expect(label('answer.q1')).toBe('응답 기업명');
    expect(label('answer.q3.c1')).toBe('(1) 2025년');
    expect(label('entry.euid')).toBe('euid');
    expect(candidates.find((c) => c.key === 'answer.q3.c1')?.varName).toBe('Q3_r1_c2');
  });

  it('조사 대상이 없는 설문에는 시스템ID 후보가 없다', () => {
    const candidates = buildClientResponseColumnCandidates({
      contactScheme: null,
      profileScheme: null,
      entryParamNames: [],
      answerSources: [],
      hasContacts: false,
    });
    expect(candidates.map((c) => c.key)).not.toContain('sys.resid');
  });
});
