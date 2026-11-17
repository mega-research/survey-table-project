import { beforeEach, describe, expect, it, vi } from 'vitest';

// 응답 내역 목록 엑셀의 재료 조립 — 화면과 같은 함수들을 어떤 인자로 부르는지, 그리고 게스트 파일에서
// 무엇을 가리는지 본다. 열 조립 자체는 lib/operations/response-list-sheet.test.ts 몫.

const { listMock, answerValuesMock, decryptPiiMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  answerValuesMock: vi.fn(),
  decryptPiiMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: async () => [],
  };
  return { db: { select: () => chain } };
});
vi.mock('@/server/read-models/contacts', () => ({
  getContactColumnScheme: vi.fn(async () => ({
    version: 1,
    headerRow: 1,
    columns: [
      { key: '담당자', label: '담당자', source: 'pii.담당자', order: 0, piiType: 'name' },
      { key: '연락처', label: '연락처', source: 'pii.연락처', order: 1, piiType: 'mobile' },
    ],
  })),
}));
vi.mock('@/server/read-models/profile-column-scheme', () => ({
  getProfileColumnScheme: vi.fn(async () => ({
    version: 1,
    columns: [
      { key: 'sys.idx', label: '순번', order: 0 },
      { key: 'answer.q1', label: '기업명', order: 1 },
      { key: 'answer.q2', label: '성명', order: 2 },
      { key: 'pii.담당자', label: '담당자', order: 3 },
      { key: 'pii.연락처', label: '연락처', order: 4 },
      { key: 'sys.status', label: '상태', order: 5 },
      // 관리자가 켜 둔 접속 식별값 열 — 게스트 파일에는 나가지 않아야 한다
      { key: 'sys.deviceId', label: '브라우저 ID', order: 6 },
      { key: 'sys.fpHash', label: '기기 사양', order: 7 },
    ],
  })),
  getProfileEntryParamNames: vi.fn(async () => []),
  getProfileAnswerSources: vi.fn(async () => [
    { key: 'answer.q1', encrypted: false },
    { key: 'answer.q2', encrypted: true },
  ]),
  getProfileAnswerChoices: vi.fn(async () => new Map()),
}));
vi.mock('@/server/read-models/survey-structure', () => ({
  getQuestionGroupsBySurvey: vi.fn(async () => []),
}));
vi.mock('@/server/operations/services/contact-stats', () => ({
  getSurveyContactStats: vi.fn(async () => ({ hasContacts: true })),
}));
vi.mock('@/server/operations/services/profiles', () => ({ listResponsesForProfiles: listMock }));
vi.mock('@/server/operations/services/profile-answer-values', () => ({
  loadProfileAnswerValues: answerValuesMock,
}));
vi.mock('@/lib/crypto/contact-pii-repo', () => ({ decryptPiiForTargets: decryptPiiMock }));
vi.mock('./raw-export-load', () => ({ MAX_EXPORT_RESPONSES: 10000 }));

import { loadResponseListTable } from './response-list-load';

const ROW = {
  id: 'r1',
  idx: 5,
  platform: 'desktop',
  browser: 'Chrome',
  status: 'completed',
  currentStepId: null,
  visibleStepIndex: null,
  visibleStepTotal: null,
  startedAt: new Date('2026-11-15T00:00:00Z'),
  completedAt: new Date('2026-11-15T00:10:00Z'),
  totalSeconds: 600,
  groupValue: null,
  resid: 1,
  attrs: null,
  contactTargetId: 't1',
  ipHash: null,
  deviceId: '5cce2545',
  fpHash: 'ec7b3f35',
  entryParams: null,
  isTest: false,
};

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ rows: [ROW], total: 1, page: 1 });
  answerValuesMock.mockReset();
  answerValuesMock.mockResolvedValue({ r1: { 'answer.q1': '메가유업', 'answer.q2': '홍길동' } });
  decryptPiiMock.mockReset();
  decryptPiiMock.mockResolvedValue(
    new Map([['t1', { 담당자: '김영희', 연락처: '010-2233-4455' }]]),
  );
});

describe('loadResponseListTable', () => {
  it('화면 기본과 같은 조건으로 전부 읽는다 — 필터 없이 순번 내림차순, 휴지통 제외', async () => {
    await loadResponseListTable('s1', 'real', { maskPii: false });
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyId: 's1',
        scope: 'real',
        page: 1,
        pageSize: 10000,
        status: 'all',
        sort: 'idx',
        dir: 'desc',
        view: 'active',
        clauses: [],
      }),
    );
    // 응답값은 표시 중인 응답값 열만, 개인정보는 표시 중인 개인정보 열만 읽는다
    expect(answerValuesMock).toHaveBeenCalledWith(
      ['r1'],
      ['answer.q1', 'answer.q2'],
      expect.anything(),
      expect.any(Function),
    );
    expect(decryptPiiMock).toHaveBeenCalledWith(['t1'], ['담당자', '연락처']);
  });

  /** 첫 줄을 머리 → 값으로 — 컬럼 설정에 없는 기본 열은 화면처럼 뒤에 붙으므로 이름으로 찾는다. */
  async function firstRow(maskPii: boolean): Promise<Record<string, string | number>> {
    const result = await loadResponseListTable('s1', 'real', { maskPii });
    if (result.kind !== 'ok') throw new Error('ok 가 아니다');
    return Object.fromEntries(result.headers.map((h, i) => [h, result.rows[0]![i]!]));
  }

  it('관리자가 받는 목록은 화면에 보이는 값 그대로다', async () => {
    expect(await firstRow(false)).toMatchObject({
      순번: 5,
      기업명: '메가유업',
      성명: '홍길동',
      담당자: '김영희',
      연락처: '010-2233-4455',
      상태: '완료',
      '마지막 응답 문항': '',
    });
  });

  it('브라우저 ID·기기 사양 열은 관리자 파일에만 나간다 — 게스트 파일은 열도 없고 값도 읽지 않는다', async () => {
    expect(await firstRow(false)).toMatchObject({ '브라우저 ID': '5cce2545', '기기 사양': 'ec7b3f35' });
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeBrowserSignals: true }),
    );

    const guest = await loadResponseListTable('s1', 'real', { maskPii: true });
    if (guest.kind !== 'ok') throw new Error('ok 가 아니다');
    expect(guest.headers).not.toContain('브라우저 ID');
    expect(guest.headers).not.toContain('기기 사양');
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeBrowserSignals: false }),
    );
  });

  it('게스트가 받는 목록은 암호화 저장 응답값 열과 명단 개인정보 열만 가린다', async () => {
    // 기업명(암호화 아님)은 그대로, 성명은 마지막 글자만, 연락처는 마스킹 힌트
    expect(await firstRow(true)).toMatchObject({
      순번: 5,
      기업명: '메가유업',
      성명: '홍길*',
      담당자: '김영*',
      연락처: '010-22...',
      상태: '완료',
    });
  });

  it('지금은 개인정보 표시가 꺼진 열이라도 저장값이 암호문이던 칸은 게스트 파일에서 가린다', async () => {
    // 기업명 열(answer.q1)은 지금 구조에서 암호화 표시가 없다 — 표시를 켠 채 받은 응답만 암호문이다.
    listMock.mockResolvedValue({
      rows: [ROW, { ...ROW, id: 'r2', idx: 6 }],
      total: 2,
      page: 1,
    });
    answerValuesMock.mockImplementation(
      async (
        _ids: string[],
        _keys: string[],
        _choices: unknown,
        onEncryptedValue?: (responseId: string, key: string) => void,
      ) => {
        onEncryptedValue?.('r1', 'answer.q1');
        return { r1: { 'answer.q1': '홍길동상회' }, r2: { 'answer.q1': '메가유업' } };
      },
    );
    const guest = await loadResponseListTable('s1', 'real', { maskPii: true });
    if (guest.kind !== 'ok') throw new Error('ok 가 아니다');
    const at = guest.headers.indexOf('기업명');
    expect(guest.rows.map((r) => r[at])).toEqual(['홍길동상*', '메가유업']);

    // 관리자는 종전대로 평문
    const admin = await loadResponseListTable('s1', 'real', { maskPii: false });
    if (admin.kind !== 'ok') throw new Error('ok 가 아니다');
    expect(admin.rows.map((r) => r[at])).toEqual(['홍길동상회', '메가유업']);
  });

  it('응답이 한도를 넘으면 읽지 않고 알린다', async () => {
    listMock.mockResolvedValue({ rows: [], total: 10001, page: 1 });
    await expect(loadResponseListTable('s1', 'real', { maskPii: true })).resolves.toEqual({
      kind: 'too_many',
      total: 10001,
    });
    expect(answerValuesMock).not.toHaveBeenCalled();
  });
});
