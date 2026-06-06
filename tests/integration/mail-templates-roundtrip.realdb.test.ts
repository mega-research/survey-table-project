/**
 * mail.templates procedure 실 DB 왕복 integration test
 *
 * 목적: procedure -> service -> 실 PostgreSQL 왕복(create/update/소프트삭제)이 실제로
 * 돈다는 것을 CI에 고정. z.custom(attachments JSONB) + 캐스팅 기반 거짓안전을 잡는다.
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * 선행 조건: 로컬 supabase 스택 + 19테이블 셋업 완료 (pnpm db:setup-test).
 *   mail_templates 는 next_contact_resid 류 커스텀 SQL 함수 의존이 없어 beforeAll 불필요.
 *
 * 주의: bodyHtml 은 tmp R2 URL 없이, attachments 는 빈 배열로 두어 promote/cleanup 이
 *   R2 를 건드리지 않는 no-op 경로를 탄다 (네트워크/버킷 불필요).
 */

import { createRouterClient } from '@orpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { mailTemplates as mailTemplatesTable } from '@/db/schema/mail';
import { surveys as surveysTable } from '@/db/schema';
import type { ORPCContext } from '@/server/context';

import { templates } from '@/features/mail/server/procedures/templates';

// prod 방어선: DATABASE_URL이 로컬이 아니면 전체 suite 스킵
const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

// promote 의 extractTmpMailUrls 가 tmp prefix 계산을 위해 R2 public URL env 를 무조건 읽는다.
// bodyHtml 에 tmp URL 이 없어 실제 R2 호출은 발생하지 않으므로 더미 값으로 충분하다.
process.env['CLOUDFLARE_R2_PUBLIC_URL'] ??= 'https://r2-test.invalid';

function adminContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: { id: 'test-admin', email: 'test@local' },
  };
}

function templateInput() {
  return {
    name: '안내 메일',
    subject: '안내드립니다',
    bodyHtml: '<p>본문 텍스트</p>',
    fromLocal: 'noreply',
    fromName: '설문팀',
    replyTo: 'reply@example.com',
    attachments: [],
  };
}

describe.skipIf(!isLocalDb)('mail.templates procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ templates }, { context: adminContext() });
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    // survey 삭제 시 mail_templates 는 FK cascade로 함께 정리되지만 명시적으로도 비운다.
    for (const id of createdSurveyIds) {
      await db.delete(mailTemplatesTable).where(eq(mailTemplatesTable.surveyId, id));
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('create -> update -> remove 왕복: 템플릿 생성/수정/소프트삭제가 DB에 반영된다', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '메일템플릿-왕복-테스트-설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    // 1. create: 템플릿이 생성되고 id/attachments 가 반환되는지 확인
    const created = await client.templates.create({
      surveyId: survey.id,
      input: templateInput(),
    });
    expect(typeof created.id).toBe('string');
    expect(created.attachments).toEqual([]);

    const [afterCreate] = await db
      .select({
        name: mailTemplatesTable.name,
        subject: mailTemplatesTable.subject,
        bodyHtml: mailTemplatesTable.bodyHtml,
        variablesUsed: mailTemplatesTable.variablesUsed,
        deletedAt: mailTemplatesTable.deletedAt,
      })
      .from(mailTemplatesTable)
      .where(eq(mailTemplatesTable.id, created.id));
    expect(afterCreate?.name).toBe('안내 메일');
    expect(afterCreate?.subject).toBe('안내드립니다');
    expect(afterCreate?.deletedAt).toBeNull();

    // 2. update: 변경이 DB에 반영되는지 확인
    const updated = await client.templates.update({
      surveyId: survey.id,
      templateId: created.id,
      input: { ...templateInput(), subject: '수정된 제목' },
    });
    expect(updated.attachments).toEqual([]);

    const [afterUpdate] = await db
      .select({ subject: mailTemplatesTable.subject })
      .from(mailTemplatesTable)
      .where(eq(mailTemplatesTable.id, created.id));
    expect(afterUpdate?.subject).toBe('수정된 제목');

    // 3. remove: soft delete (deleted_at 세팅, 행은 보존)
    const removeRes = await client.templates.remove({
      surveyId: survey.id,
      templateId: created.id,
    });
    expect(removeRes).toEqual({ ok: true });

    const [afterRemove] = await db
      .select({ deletedAt: mailTemplatesTable.deletedAt })
      .from(mailTemplatesTable)
      .where(eq(mailTemplatesTable.id, created.id));
    expect(afterRemove?.deletedAt).not.toBeNull();

    // soft delete 된 행은 active(deletedAt IS NULL) 조회에서 제외된다.
    const active = await db
      .select({ id: mailTemplatesTable.id })
      .from(mailTemplatesTable)
      .where(
        and(eq(mailTemplatesTable.id, created.id), isNull(mailTemplatesTable.deletedAt)),
      );
    expect(active.length).toBe(0);
  });

  it('다른 설문의 템플릿 update는 NOT_FOUND로 거부된다', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '메일템플릿-가드-테스트-설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    const created = await client.templates.create({
      surveyId: survey.id,
      input: templateInput(),
    });

    // 존재하지 않는 surveyId(엉뚱한 UUID)로 update 시도 -> not found
    await expect(
      client.templates.update({
        surveyId: '00000000-0000-4000-8000-000000000000',
        templateId: created.id,
        input: templateInput(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
