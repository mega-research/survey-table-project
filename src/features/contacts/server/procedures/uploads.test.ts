import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactUploadMapping } from '@/db/schema/schema-types';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-uploads.service', () => ({
  parseExcelPreview: vi.fn(),
  ingestContactUpload: vi.fn(),
}));

vi.mock('../services/contact-columns.service', () => ({
  updateContactColumns: vi.fn(),
  getExistingContactsCount: vi.fn(),
}));

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => 'real'),
}));

import * as columnsSvc from '../services/contact-columns.service';
import * as uploadsSvc from '../services/contact-uploads.service';
import { uploads } from './uploads';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
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
    } as never);
    const client = createRouterClient({ uploads }, { context: authedContext() });
    const file = xlsxFile();
    const res = await client.uploads.ingest({ surveyId: 'sv-1', file, mapping });
    expect(uploadsSvc.ingestContactUpload).toHaveBeenCalledOnce();
    const arg = vi.mocked(uploadsSvc.ingestContactUpload).mock.calls[0]?.[0];
    expect(arg?.file).toBeInstanceOf(File);
    expect(arg?.surveyId).toBe('sv-1');
    expect(res.uploadId).toBe('up-1');
  });

  it('existingCount는 surveyId를 service.getExistingContactsCount에 위임한다', async () => {
    vi.mocked(columnsSvc.getExistingContactsCount).mockResolvedValue(7 as never);
    const client = createRouterClient({ uploads }, { context: authedContext() });
    const res = await client.uploads.existingCount({ surveyId: 'sv-1' });
    expect(columnsSvc.getExistingContactsCount).toHaveBeenCalledWith('sv-1', 'real');
    expect(res).toBe(7);
  });

  it('인증 없으면 existingCount가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { uploads },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.uploads.existingCount({ surveyId: 'sv-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
