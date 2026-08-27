import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactUploadMapping } from '@/shared/contracts/contacts';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-uploads', () => ({
  parseExcelPreview: vi.fn(),
  ingestContactUpload: vi.fn(),
  matchContactUpload: vi.fn(),
}));

vi.mock('../services/contact-columns', () => ({
  updateContactColumns: vi.fn(),
  getExistingContactsCount: vi.fn(),
}));

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(async () => 'real'),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as columnsSvc from '../services/contact-columns';
import * as uploadsSvc from '../services/contact-uploads';
import { uploads } from './uploads';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

const mapping: ContactUploadMapping = {
  systemFields: {},
  selectedAttrsKeys: ['name'],
  headerRow: 1,
  sheetName: 'Sheet1',
};

function xlsxFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'contacts.xlsx');
}

describe('contacts.uploads procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parsePreview는 File 입력을 service.parseExcelPreview에 위임한다', async () => {
    vi.mocked(uploadsSvc.parseExcelPreview).mockResolvedValue({
      sheetNames: ['Sheet1'],
      headers: ['name'],
      rows: [{ name: '홍길동' }],
      totalRows: 1,
    } as never);
    const client = createRouterClient({ uploads }, { context: authedContext() });
    const file = xlsxFile();
    const res = await client.uploads.parsePreview({ file, headerRow: 1 });
    // surveyId 없는 무상태 파싱 — capability 관문을 태울 대상이 없어 authed 만 지난다.
    expect(assertSurveyCapabilityRpc).not.toHaveBeenCalled();
    expect(uploadsSvc.parseExcelPreview).toHaveBeenCalledOnce();
    const arg = vi.mocked(uploadsSvc.parseExcelPreview).mock.calls[0]?.[0];
    expect(arg?.file).toBeInstanceOf(File);
    expect(arg?.headerRow).toBe(1);
    expect(res.totalRows).toBe(1);
  });

  it('ingest는 File + mapping을 service.ingestContactUpload에 위임한다', async () => {
    vi.mocked(uploadsSvc.ingestContactUpload).mockResolvedValue({
      uploadId: 'up-1',
      uploadedRows: 1,
      mergedRows: 0,
      errorRows: 0,
      skippedRows: 0,
      skippedBreakdown: { policy: 0, fileDuplicates: 0, multiMatches: 0, emptyKeys: 0 },
    } as never);
    const context = authedContext();
    const client = createRouterClient({ uploads }, { context });
    const file = xlsxFile();
    const res = await client.uploads.ingest({ surveyId: 'sv-1', file, mapping });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 'sv-1', 'contacts.manage');
    expect(uploadsSvc.ingestContactUpload).toHaveBeenCalledOnce();
    const arg = vi.mocked(uploadsSvc.ingestContactUpload).mock.calls[0]?.[0];
    expect(arg?.file).toBeInstanceOf(File);
    expect(arg?.surveyId).toBe('sv-1');
    expect(res.uploadId).toBe('up-1');
  });

  it('matchPreview는 File + mapping을 service.matchContactUpload에 위임한다', async () => {
    vi.mocked(uploadsSvc.matchContactUpload).mockResolvedValue({
      matched: 1,
      unmatched: 0,
      fileDuplicates: 0,
      multiMatches: 0,
      emptyKeys: 0,
      unmatchedSamples: [],
      fileDuplicateSamples: [],
      multiMatchSamples: [],
      emptyKeySamples: [],
      emptyOverwrites: [],
    });
    const context = authedContext();
    const client = createRouterClient({ uploads }, { context });
    const res = await client.uploads.matchPreview({
      surveyId: 'survey-1',
      file: xlsxFile(),
      mapping: { ...mapping, mode: 'merge', mergeKeys: ['name'] },
    });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      'survey-1',
      'contacts.manage',
    );
    expect(uploadsSvc.matchContactUpload).toHaveBeenCalledOnce();
    expect(res.matched).toBe(1);
  });

  it('existingCount는 surveyId를 service.getExistingContactsCount에 위임한다', async () => {
    vi.mocked(columnsSvc.getExistingContactsCount).mockResolvedValue(7 as never);
    const context = authedContext();
    const client = createRouterClient({ uploads }, { context });
    const res = await client.uploads.existingCount({ surveyId: 'sv-1' });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 'sv-1', 'contacts.manage');
    expect(columnsSvc.getExistingContactsCount).toHaveBeenCalledWith('sv-1', 'real');
    expect(res).toBe(7);
  });

  it('타 팀 설문 id 로 ingest 하면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ uploads }, { context: authedContext() });
    await expect(
      client.uploads.ingest({ surveyId: 'sv-1', file: xlsxFile(), mapping }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(uploadsSvc.ingestContactUpload).not.toHaveBeenCalled();
  });

  it('인증 없으면 existingCount가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { uploads },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.uploads.existingCount({ surveyId: 'sv-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
