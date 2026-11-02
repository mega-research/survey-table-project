import { and, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyFavorites } from '@/db/schema';

import type { SetFavoriteInput, SetFavoriteOutput } from '../domain/personal-marks';

/**
 * 즐겨찾기 맞추기 — 결과 상태 지정 (설문 즐겨찾기·태그 티켓 06).
 *
 * 볼 수 있는 설문인지는 procedure 의 `survey.view` 관문이 끝냈다 — 편집 권한이 없어도 볼 수
 * 있으면 켤 수 있다. 여기는 요청자 본인의 행만 만진다(`userId` 는 세션에서 온다).
 *
 * - 켜기: `ON CONFLICT DO NOTHING` 삽입 — 이미 켜져 있으면 아무 일도 없다.
 * - 끄기: 삭제 — 켠 적이 없어도 오류가 아니다.
 *
 * 그래서 연타·재시도·탭 두 개가 마지막으로 도착한 상태로 수렴한다. `updatedAt` 은 건드리지 않는다
 * — 설문 내용이 아니라 내 정리라 「최신 수정순」이 별 하나에 흔들리면 안 된다.
 */
export async function setFavorite(
  userId: string,
  input: SetFavoriteInput,
): Promise<SetFavoriteOutput> {
  if (input.on) {
    await db
      .insert(surveyFavorites)
      .values({ userId, surveyId: input.surveyId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(surveyFavorites)
      .where(and(eq(surveyFavorites.userId, userId), eq(surveyFavorites.surveyId, input.surveyId)));
  }
  return { surveyId: input.surveyId, on: input.on };
}
