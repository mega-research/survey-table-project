import { beforeEach, describe, expect, it, vi } from 'vitest';

// 공지 첨부 승격 체이닝 5경로 통합 테스트 — S3 경계(@aws-sdk/client-s3) mock.
// 대상 경로: createQuestion / updateQuestion(부분 patch no-op 포함) /
// createSavedQuestion / updateSavedQuestion / importLibrary.
// 실제 promote 모듈(survey-image-promote, notice-attachment-promote)과
// copyR2Objects 는 실코드를 그대로 태우고, S3Client.send 만 흉내 낸다.

const { s3State, dbState } = vi.hoisted(() => ({
  s3State: {
    // 승격 완료된(copy 성공한) dstKey 집합 — HeadObject 는 이 집합 기준으로 응답
    storedKeys: new Set<string>(),
    // CopyObject 시도 이력 (dstKey) — no-op 검증용
    copyAttempts: [] as string[],
    // 이 dstKey 로의 copy 는 항상 실패시킨다 — abort 의미론 검증용
    failCopyDstKeys: new Set<string>(),
  },
  dbState: {
    inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updated: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  },
}));

vi.mock('@aws-sdk/client-s3', () => {
  class CopyObjectCommand {
    input: { Bucket?: string; CopySource?: string; Key?: string };
    constructor(input: { Bucket?: string; CopySource?: string; Key?: string }) {
      this.input = input;
    }
  }
  class HeadObjectCommand {
    input: { Bucket?: string; Key?: string };
    constructor(input: { Bucket?: string; Key?: string }) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    async send(command: unknown): Promise<Record<string, never>> {
      if (command instanceof CopyObjectCommand) {
        const dstKey = command.input.Key ?? '';
        s3State.copyAttempts.push(dstKey);
        if (s3State.failCopyDstKeys.has(dstKey)) {
          throw new Error(`mock CopyObject 실패: ${dstKey}`);
        }
        s3State.storedKeys.add(dstKey);
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const key = command.input.Key ?? '';
        // 첫 조회(승격 전)는 404 성격의 reject, copy 성공 후에는 resolve
        if (s3State.storedKeys.has(key)) return {};
        throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
      }
      return {};
    }
  }
  return {
    S3Client,
    CopyObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
  };
});

// 실DB 금지 — drizzle 체인 mock (campaign-dispatch-safety 패턴 축약형)
vi.mock('@/db', () => {
  const tableName = (table: object): string =>
    String(Reflect.get(table, Symbol.for('drizzle:Name')) ?? 'unknown');

  const makeInsert = (table: object) => ({
    values(vals: Record<string, unknown> | Array<Record<string, unknown>>) {
      const rows = Array.isArray(vals) ? vals : [vals];
      for (const row of rows) {
        dbState.inserted.push({ table: tableName(table), values: row });
      }
      const result = rows.map((row, index) => ({
        id: `inserted-${index}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      }));
      return {
        returning: async () => result,
        then<T>(resolve: (value: unknown[]) => T) {
          return Promise.resolve(result).then(resolve);
        },
      };
    },
  });

  const makeUpdate = (table: object) => ({
    set(payload: Record<string, unknown>) {
      dbState.updated.push({ table: tableName(table), payload });
      const result = [
        {
          id: 'updated-row',
          surveyId: 'survey-1',
          name: '보관 질문',
          description: null,
          category: 'general',
          tags: [] as string[],
          usageCount: 0,
          isPreset: false,
          question: { id: 'q-lib', type: 'notice', title: '공지', required: false, order: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
          ...payload,
        },
      ];
      return {
        where: () => ({
          returning: async () => result,
        }),
      };
    },
  });

  // 질문 서비스의 read→write→수집 트랜잭션 지원 (이슈 05·06) — tx 안의
  // before-read 는 빈 결과라 저장 diff 수집이 no-op 이고, insert/update 는
  // 본체와 같은 기록기를 공유해 기존 단언이 유지된다.
  const makeTx = () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: (table: object) => makeInsert(table),
    update: (table: object) => makeUpdate(table),
    delete: () => ({ where: async () => undefined }),
  });

  return {
    db: {
      insert: (table: object) => makeInsert(table),
      update: (table: object) => makeUpdate(table),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
    },
  };
});

vi.mock('@/data/surveys', () => ({
  getQuestionsBySurvey: vi.fn(async () => []),
}));

vi.mock('@/data/library', () => ({
  getAllCategories: vi.fn(async () => []),
}));

import { importLibrary } from '@/features/library/server/services/library-transfer.service';
import {
  createSavedQuestion,
  updateSavedQuestion,
} from '@/features/library/server/services/saved-questions.service';
import {
  createQuestion,
  updateQuestion,
} from '@/features/survey-builder/server/services/questions.service';
import { NoticeAttachmentPromoteError } from '@/lib/survey/notice-attachment-promote';
import type { Question } from '@/types/survey';

const PUBLIC_URL = 'https://cdn.test';

process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account';
process.env['CLOUDFLARE_R2_ACCESS_KEY'] = 'test-access-key';
process.env['CLOUDFLARE_R2_SECRET_KEY'] = 'test-secret-key';
process.env['CLOUDFLARE_R2_BUCKET'] = 'test-bucket';
process.env['CLOUDFLARE_R2_PUBLIC_URL'] = PUBLIC_URL;

function noticeHtml(file: string): string {
  return (
    `<p><a data-file-attachment="true" href="${PUBLIC_URL}/tmp/notice-attachment/${file}" ` +
    `data-key="tmp/notice-attachment/${file}">첨부파일</a></p>`
  );
}

function noticeQuestion(id: string, file: string): Question {
  return {
    id,
    type: 'notice',
    title: '공지 질문',
    required: false,
    order: 0,
    noticeContent: noticeHtml(file),
  };
}

function expectPromotedHtml(html: string, file: string): void {
  expect(html).toContain(`${PUBLIC_URL}/notice-attachment/${file}`);
  expect(html).not.toContain('tmp/notice-attachment/');
}

beforeEach(() => {
  s3State.storedKeys.clear();
  s3State.copyAttempts.length = 0;
  s3State.failCopyDstKeys.clear();
  dbState.inserted.length = 0;
  dbState.updated.length = 0;
});

describe('공지 첨부 승격 체이닝 — 질문 단건 경로', () => {
  it('createQuestion 이 이미지 승격에 이어 공지 첨부를 영구 위치로 승격해 저장한다', async () => {
    const created = await createQuestion({
      surveyId: 'survey-1',
      type: 'notice',
      title: '공지',
      noticeContent:
        `<p><img src="${PUBLIC_URL}/tmp/survey/img1.webp" /></p>` + noticeHtml('a.pdf'),
      requiresAcknowledgment: true,
    });

    // S3 경계: tmp -> 영구 copy 가 실제로 일어났다
    expect(s3State.storedKeys.has('notice-attachment/a.pdf')).toBe(true);
    expect(s3State.storedKeys.has('survey/img1.webp')).toBe(true);

    // 저장 payload 와 반환값 모두 영구 URL 로 치환됨
    const insertedRow = dbState.inserted.find((row) => row.table === 'questions');
    expect(insertedRow).toBeDefined();
    const savedHtml = String(insertedRow?.values['noticeContent']);
    expectPromotedHtml(savedHtml, 'a.pdf');
    expect(savedHtml).toContain(`${PUBLIC_URL}/survey/img1.webp`);
    expect(savedHtml).not.toContain('tmp/survey/');
    expectPromotedHtml(created.noticeContent ?? '', 'a.pdf');
  });

  it('updateQuestion 이 noticeContent patch 의 tmp 첨부를 승격해 저장한다', async () => {
    await updateQuestion('question-1', 'survey-1', {
      noticeContent: noticeHtml('b.pdf'),
    });

    expect(s3State.storedKeys.has('notice-attachment/b.pdf')).toBe(true);
    const updatedRow = dbState.updated.find((row) => row.table === 'questions');
    expect(updatedRow).toBeDefined();
    expectPromotedHtml(String(updatedRow?.payload['noticeContent']), 'b.pdf');
  });

  it('updateQuestion 부분 patch 에 noticeContent 가 없으면 승격은 no-op 로 안전하다', async () => {
    await updateQuestion('question-1', 'survey-1', { title: '제목만 변경' });

    // 승격 대상 URL 이 없으므로 S3 호출 자체가 없다
    expect(s3State.copyAttempts).toHaveLength(0);
    const updatedRow = dbState.updated.find((row) => row.table === 'questions');
    expect(updatedRow).toBeDefined();
    expect(updatedRow?.payload['title']).toBe('제목만 변경');
    expect(updatedRow?.payload).not.toHaveProperty('noticeContent');
  });

  it('공지 첨부 승격이 최종 실패하면 createQuestion 저장을 abort 한다', async () => {
    s3State.failCopyDstKeys.add('notice-attachment/fail.pdf');

    await expect(
      createQuestion({
        surveyId: 'survey-1',
        type: 'notice',
        title: '공지',
        noticeContent: noticeHtml('fail.pdf'),
      }),
    ).rejects.toBeInstanceOf(NoticeAttachmentPromoteError);

    // promote 가 insert 앞이므로 실패 시 저장 자체가 일어나지 않는다
    expect(dbState.inserted).toHaveLength(0);
  });
});

describe('공지 첨부 승격 체이닝 — 보관함 경로', () => {
  it('createSavedQuestion 이 공지 첨부를 승격해 보관한다', async () => {
    await createSavedQuestion({
      question: noticeQuestion('q-save', 'c.pdf'),
      metadata: { name: '보관 공지', category: 'general' },
    });

    expect(s3State.storedKeys.has('notice-attachment/c.pdf')).toBe(true);
    const insertedRow = dbState.inserted.find((row) => row.table === 'saved_questions');
    expect(insertedRow).toBeDefined();
    const savedQuestion = insertedRow?.values['question'] as Question;
    expectPromotedHtml(savedQuestion.noticeContent ?? '', 'c.pdf');
  });

  it('updateSavedQuestion 이 question 포함 patch 의 공지 첨부를 승격한다', async () => {
    await updateSavedQuestion('saved-1', {
      question: noticeQuestion('q-update', 'd.pdf'),
    });

    expect(s3State.storedKeys.has('notice-attachment/d.pdf')).toBe(true);
    const updatedRow = dbState.updated.find((row) => row.table === 'saved_questions');
    expect(updatedRow).toBeDefined();
    const updatedQuestion = updatedRow?.payload['question'] as Question;
    expectPromotedHtml(updatedQuestion.noticeContent ?? '', 'd.pdf');
  });
});

describe('공지 첨부 승격 체이닝 — 라이브러리 가져오기 경로', () => {
  it('importLibrary 가 가져온 질문의 공지 첨부를 승격해 insert 한다', async () => {
    const json = JSON.stringify({
      savedQuestions: [
        {
          name: '가져온 공지',
          category: 'general',
          tags: ['공지'],
          usageCount: 3,
          isPreset: true,
          question: noticeQuestion('q-import', 'e.pdf'),
        },
      ],
    });

    await importLibrary(json);

    expect(s3State.storedKeys.has('notice-attachment/e.pdf')).toBe(true);
    const insertedRow = dbState.inserted.find((row) => row.table === 'saved_questions');
    expect(insertedRow).toBeDefined();
    const importedQuestion = insertedRow?.values['question'] as Question;
    expectPromotedHtml(importedQuestion.noticeContent ?? '', 'e.pdf');
    // import 는 항상 isPreset false 로 강등 (기존 거동 회귀 확인)
    expect(insertedRow?.values['isPreset']).toBe(false);
  });
});
