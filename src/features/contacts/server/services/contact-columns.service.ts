import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { isGroupLevel } from '@/lib/contacts/group-levels';
import { testFlagForScope, type OperationsDataScope } from '@/lib/operations/data-scope.server';

import type {
  UpdateContactColumnsInput,
  UpdateContactGroupLevelsInput,
} from '../../domain/contact-column';

/**
 * 컨택리스트 표시 컬럼 스킴(surveys.contactColumns) 갱신.
 * resid hide 불가 가드(spec 엣지케이스 #28)는 제거됨 — 고객 엑셀의 NO/ID 컬럼이
 * 식별자 역할을 대신하는 운용을 허용한다. 기본 정렬·컨택 상세·초대링크는
 * resid 표시 여부와 무관하게 동작한다.
 * 인증은 authed 미들웨어, 캐시 갱신은 소비처 router.refresh/push 로 대체.
 */
export async function updateContactColumns(input: UpdateContactColumnsInput): Promise<void> {
  const { surveyId, scheme } = input;
  // 분류 기준 레벨 가드 — attrs.* 전용, 레벨 1..4, 레벨당 컬럼 1개
  const leveled = scheme.columns.filter((c) => c.groupLevel != null);
  if (leveled.some((c) => !c.source.startsWith('attrs.'))) {
    throw new Error('분류 기준은 명단 속성(attrs) 컬럼에만 지정할 수 있습니다.');
  }
  if (leveled.some((c) => !isGroupLevel(c.groupLevel))) {
    throw new Error('분류 기준 레벨은 대·중·소·세부분류만 가능합니다.');
  }
  const levels = leveled.map((c) => c.groupLevel);
  if (new Set(levels).size !== levels.length) {
    throw new Error('같은 분류 레벨을 여러 컬럼에 지정할 수 없습니다.');
  }
  await db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    if (!survey) throw new Error('NOT_FOUND');

    await tx
      .update(surveys)
      .set(survey.enabled ? { testContactColumns: scheme } : { contactColumns: scheme })
      .where(eq(surveys.id, surveyId));
  });
}

/**
 * 분류 기준 레벨만 패치 — 최신 스킴을 행 잠금 후 groupLevel 필드만 갱신.
 * 클라이언트가 들고 있던 스킴 스냅샷 전체를 덮어쓰지 않으므로, 다른 편집자의
 * 라벨·순서·표시 변경이나 업로드로 추가된 컬럼이 유실되지 않는다.
 * levels 에 없는 attrs 컬럼의 레벨은 해제, legacy groupBy 플래그도 함께 제거한다.
 */
export async function updateContactGroupLevels(
  input: UpdateContactGroupLevelsInput,
): Promise<void> {
  const { surveyId, levels } = input;
  const levelValues = Object.values(levels);
  if (levelValues.some((l) => !isGroupLevel(l))) {
    throw new Error('분류 기준 레벨은 대·중·소·세부분류만 가능합니다.');
  }
  if (new Set(levelValues).size !== levelValues.length) {
    throw new Error('같은 분류 레벨을 여러 컬럼에 지정할 수 없습니다.');
  }
  await db.transaction(async (tx) => {
    const [survey] = await tx
      .select({
        enabled: surveys.testModeEnabled,
        contactColumns: surveys.contactColumns,
        testContactColumns: surveys.testContactColumns,
      })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .for('update');
    if (!survey) throw new Error('NOT_FOUND');

    const scheme = survey.enabled ? survey.testContactColumns : survey.contactColumns;
    if (!scheme || !Array.isArray(scheme.columns)) {
      throw new Error('컬럼 스킴이 없습니다. 먼저 명단을 업로드하세요.');
    }

    const patched = {
      ...scheme,
      columns: scheme.columns.map((c) => {
        const { groupBy: _legacy, groupLevel: _old, ...rest } = c;
        const requested = levels[c.key];
        const level =
          c.source.startsWith('attrs.') && isGroupLevel(requested) ? requested : undefined;
        return { ...rest, ...(level != null ? { groupLevel: level } : {}) };
      }),
    };

    await tx
      .update(surveys)
      .set(survey.enabled ? { testContactColumns: patched } : { contactColumns: patched })
      .where(eq(surveys.id, surveyId));
  });
}

/**
 * 업로드 마법사 경고 카드용 — 기존 컨택 행 수.
 * 0 이면 신규 업로드, > 0 이면 통째 교체 경고 필요.
 */
export async function getExistingContactsCount(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, testFlagForScope(scope)),
      ),
    );
  return row?.total ?? 0;
}
