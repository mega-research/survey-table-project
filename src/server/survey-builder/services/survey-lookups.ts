import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@/db';
import { savedLookups, surveys } from '@/db/schema';
import type { SurveyLookup } from '@/types/survey';

// ========================
// 설문 LUT (surveys.lookups jsonb)
// ========================

// 보관함 → 설문으로 LUT 추가.
//
// 같은 sourceSavedLookupId 사본이 이미 있으면 중복 추가하지 않고 데이터만 최신 보관함 값으로 갱신.
// (사용자가 같은 LUT 를 여러 번 "이 설문에 추가" 눌러도 사본이 쌓이지 않음)
export async function copySavedLookupToSurvey(
  surveyId: string,
  savedLookupId: string,
): Promise<SurveyLookup> {
  const saved = await db.query.savedLookups.findFirst({
    where: eq(savedLookups.id, savedLookupId),
  });
  if (!saved) {
    throw new Error('보관함 LUT 를 찾을 수 없습니다.');
  }

  // surveys.lookups jsonb 는 read-modify-write 이므로 동시 호출 시 lost update 가 발생한다.
  // 트랜잭션 내에서 row 를 FOR UPDATE 로 잠근 뒤 읽고 써서 직렬화한다.
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ lookups: surveys.lookups })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    const survey = rows[0];
    if (!survey) {
      throw new Error('설문을 찾을 수 없습니다.');
    }

    const list = survey.lookups ?? [];
    const existing = list.find((l) => l.sourceSavedLookupId === savedLookupId);

    if (existing) {
      // 이미 등록된 사본 → 데이터만 최신 보관함 값으로 갱신 (id 보존, usageCount 증가 안 함)
      const updated: SurveyLookup = {
        ...existing,
        name: saved.name,
        columns: saved.columns,
        rows: saved.rows,
      };
      const next = list.map((l) => (l.id === existing.id ? updated : l));
      await tx
        .update(surveys)
        .set({ lookups: next, updatedAt: new Date() })
        .where(eq(surveys.id, surveyId));
      return updated;
    }

    // 신규 사본 추가 + usageCount 증가
    const newLookup: SurveyLookup = {
      id: nanoid(),
      name: saved.name,
      sourceSavedLookupId: saved.id,
      columns: saved.columns,
      rows: saved.rows,
    };
    const next = [...list, newLookup];

    await tx
      .update(surveys)
      .set({ lookups: next, updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));

    await tx
      .update(savedLookups)
      .set({ usageCount: sql`${savedLookups.usageCount} + 1` })
      .where(eq(savedLookups.id, savedLookupId));

    return newLookup;
  });
}

// 설문 LUT upsert (신규 추가 또는 기존 id 갱신)
export async function upsertSurveyLookup(
  surveyId: string,
  lookup: SurveyLookup,
): Promise<SurveyLookup> {
  // read-modify-write 직렬화: row FOR UPDATE 잠금으로 동시 호출 lost update 방지
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ lookups: surveys.lookups })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    const survey = rows[0];
    if (!survey) {
      throw new Error('설문을 찾을 수 없습니다.');
    }

    const list: SurveyLookup[] = survey.lookups ?? [];
    const idx = list.findIndex((l) => l.id === lookup.id);

    const next: SurveyLookup[] =
      idx >= 0
        ? list.map((l, i) => (i === idx ? lookup : l))
        : [...list, { ...lookup, id: lookup.id || nanoid() }];

    await tx
      .update(surveys)
      .set({ lookups: next, updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));

    const resultIndex = idx >= 0 ? idx : next.length - 1;
    const result = next[resultIndex];
    if (!result) throw new Error('upsertSurveyLookup: 저장 결과 조회 실패');
    return result;
  });
}

// 설문 LUT 삭제
export async function deleteSurveyLookup(
  surveyId: string,
  surveyLookupId: string,
): Promise<void> {
  // read-modify-write 직렬화: row FOR UPDATE 잠금으로 동시 호출 lost update 방지
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ lookups: surveys.lookups })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    const survey = rows[0];
    if (!survey) {
      throw new Error('설문을 찾을 수 없습니다.');
    }

    const next: SurveyLookup[] = (survey.lookups ?? []).filter(
      (l) => l.id !== surveyLookupId,
    );

    await tx
      .update(surveys)
      .set({ lookups: next, updatedAt: new Date() })
      .where(eq(surveys.id, surveyId));
  });
}
