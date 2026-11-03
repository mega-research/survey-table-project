/**
 * Raw 내보내기 조사 대상 표식 — 마지막 회차 결과코드와 손으로 고친 명단 열의 실 DB 왕복.
 *
 * 결과코드는 회차 번호가 가장 큰 기록 하나(운영 콘솔 「컨택결과」 열과 같은 기준)이고, 고친 열은
 * 「대상 정보 수정 현황」의 정보 수정 기록에서 온다 — 회차 수정 기록(attempt_edit)은 명단 열이 아니다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactAttempts, contactTargetEditLogs, contactTargets, surveys } from '@/db/schema';
import {
  loadEditedSources,
  loadLatestResultCodes,
} from '@/server/read-models/contact-export-marks';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

run('Raw 내보내기 조사 대상 표식 (real DB)', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  async function seed(n: number) {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({ id: surveyId, title: '내보내기 표식' });
    const ids = Array.from({ length: n }, () => randomUUID());
    await db.insert(contactTargets).values(
      ids.map((id, i) => ({
        id,
        surveyId,
        resid: i + 1,
        isTest: false,
        attrs: { 기업명: i === 0 ? '아리오나트' : '원래' },
        inviteCode: randomUUID(),
      })),
    );
    return { surveyId, ids };
  }

  it('결과코드는 회차 번호가 가장 큰 기록이고, 회차가 없는 대상은 맵에 없다', async () => {
    const { ids } = await seed(3);
    const [a, b, c] = ids as [string, string, string];
    await db.insert(contactAttempts).values([
      { contactTargetId: a, attemptNo: 2, resultCode: '13.독려' },
      { contactTargetId: a, attemptNo: 1, resultCode: '3.비수신' },
      { contactTargetId: b, attemptNo: 1, resultCode: '수신거부' },
    ]);

    const codes = await loadLatestResultCodes([a, b, c, a]);

    expect(codes.get(a)).toBe('13.독려');
    expect(codes.get(b)).toBe('수신거부');
    expect(codes.has(c)).toBe(false);
  });

  it('정보 수정 기록만 보고, 원래대로 돌려놓은 일반 열은 칠하지 않는다', async () => {
    const { surveyId, ids } = await seed(2);
    const [a, b] = ids as [string, string];
    // 한 줄씩 넣는다 — 한 문장에 여러 줄을 넣으면 created_at 이 같아져 순서가 정해지지 않는다.
    // 실제 수정은 요청마다 따로 저장돼 시각이 다르다.
    const rows: (typeof contactTargetEditLogs.$inferInsert)[] = [
      {
        surveyId,
        contactTargetId: a,
        action: 'info_edit',
        changes: [
          { kind: 'attr', key: '기업명', label: '기업명', before: '-', after: '아리오나트' },
          { kind: 'pii', key: '대표번호', label: '대표번호', op: 'set' },
        ],
      },
      {
        surveyId,
        contactTargetId: b,
        action: 'info_edit',
        changes: [{ kind: 'attr', key: '기업명', label: '기업명', before: '원래', after: '잠깐' }],
      },
      {
        surveyId,
        contactTargetId: b,
        action: 'info_edit',
        changes: [{ kind: 'attr', key: '기업명', label: '기업명', before: '잠깐', after: '원래' }],
      },
      {
        surveyId,
        contactTargetId: b,
        action: 'attempt_delete',
        changes: [
          {
            kind: 'attempt',
            attemptNo: 1,
            before: { resultCode: '3.비수신', note: null, createdByEmail: null, createdAt: '2026-11-03T00:00:00Z' },
            after: null,
          },
        ],
      },
    ];
    for (const row of rows) {
      await db.insert(contactTargetEditLogs).values({ ...row, createdAt: new Date(Date.now() + rows.indexOf(row)) });
    }

    const edited = await loadEditedSources([
      { id: a, attrs: { 기업명: '아리오나트' } },
      { id: b, attrs: { 기업명: '원래' } },
    ]);

    expect([...(edited.get(a) ?? [])].sort()).toEqual(['attrs.기업명', 'pii.대표번호']);
    expect(edited.has(b)).toBe(false);
  });
});
