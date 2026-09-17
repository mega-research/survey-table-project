import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyVersions } from '@/db/schema';

/**
 * 응답이 묶인 버전의 스냅샷 상태 — 저장 거부의 원인을 가르고, 테스트 응답이면 안내로 접는다.
 *
 * 발행 때 옛 버전 스냅샷을 비우는 정리(version-retention)는 **실응답이 묶인 버전만** 보존한다.
 * 테스트 응답이 묶인 버전은 비워질 수 있고, 그러면 그 응답의 저장은 문항 소속 검증에서 전부
 * 거부된다. 실응답에는 일어나지 않는 일이라 테스트 행에 한해 "다시 시작" 안내로 바꾼다.
 */

/** Sentry 이벤트에 실을 진단 정보를 들고 다니는 에러 — rpc-logging 이 scope context 로 붙인다. */
export interface SentryContextCarrier {
  sentryContext: Record<string, unknown>;
}

/** Sentry 에 문항 id 를 전부 싣지 않는다 — 수십 개면 이벤트만 커지고 원인 판별에는 앞 몇 개면 된다. */
const MAX_REPORTED_QUESTION_IDS = 20;

/**
 * 저장 요청의 문항 키가 응답 버전(또는 설문)에 없다. 응답자 문구는 기존 그대로이고,
 * 원인을 가릴 식별자는 sentryContext 로 들고 간다.
 */
export class QuestionNotInResponseVersionError extends Error implements SentryContextCarrier {
  readonly versionId: string | null;
  readonly sentryContext: Record<string, unknown>;

  constructor(args: { surveyId: string; versionId: string | null; missingQuestionIds: string[] }) {
    super('해당 설문에 존재하지 않는 질문입니다.');
    this.name = 'QuestionNotInResponseVersionError';
    this.versionId = args.versionId;
    this.sentryContext = {
      surveyId: args.surveyId,
      versionId: args.versionId,
      missingCount: args.missingQuestionIds.length,
      missingQuestionIds: args.missingQuestionIds.slice(0, MAX_REPORTED_QUESTION_IDS),
    };
  }
}

/** 테스트 응답이 묶인 버전의 스냅샷이 재발행 정리로 비워졌다 — procedure 가 안내 코드로 접는다. */
export class TestResponseVersionPrunedError extends Error {
  constructor() {
    super('테스트 도중 설문이 다시 발행되어 이 테스트 응답을 이어서 저장할 수 없습니다.');
    this.name = 'TestResponseVersionPrunedError';
  }
}

/** 버전 스냅샷이 정리로 비워졌는지. 행이 없으면 false — 그건 정리가 아니라 다른 문제다. */
export async function isVersionSnapshotPruned(versionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: surveyVersions.id, snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.id, versionId))
    .limit(1);
  return row != null && row.snapshot == null;
}

/**
 * 소속 검증 거부를 원인별로 가른다.
 * - 스냅샷이 비워진 버전의 테스트 응답 → TestResponseVersionPrunedError (안내로 접힘, Sentry 제외)
 * - 그 밖 → 원래 에러에 응답 id·스냅샷 상태를 덧붙여 그대로 (Sentry 에서 원인이 보이게)
 */
export async function classifyQuestionMembershipError(
  err: unknown,
  row: { id: string; isTest: boolean; versionId: string | null },
): Promise<unknown> {
  if (!(err instanceof QuestionNotInResponseVersionError) || !row.versionId) return err;
  const pruned = await isVersionSnapshotPruned(row.versionId);
  if (pruned && row.isTest) return new TestResponseVersionPrunedError();
  Object.assign(err.sentryContext, {
    responseId: row.id,
    isTest: row.isTest,
    versionSnapshotPruned: pruned,
  });
  return err;
}
