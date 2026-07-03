/**
 * Dev only — 한 설문에 30건 mock 종결 응답을 INSERT.
 *
 * 실행: pnpm tsx scripts/seed-fieldwork-mock.ts <survey_id>
 *
 * 분포 (대략):
 *   - status: completed 25 / drop 5
 *   - platform: desktop 18 / mobile 9 / tablet 3
 *   - browser: Chrome / Safari / Firefox / Edge (UA 샘플 기반)
 *   - 응답시간(seconds): 정상 분포 N(600, 200), 절사 검증용 outlier 2건 (4500, 9000)
 *   - 시작 일자: 최근 14일 균등 분포 (UTC)
 *   - page_visits: snapshot의 groups + table questions 순서대로 step 시뮬레이션
 *     dwell time per step: N(60, 20) seconds
 *   - drop: 50~80% 페이지에서 끊김
 *
 * NOTE: production DB에 직접 적용 금지. dev/staging 시각 검증용.
 */
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  questions,
  responseAnswers,
  surveyResponses,
  surveyVersions,
  surveys,
} from '@/db/schema';
import type { PageVisit, SurveyVersionSnapshot } from '@/db/schema/schema-types';
import { generateFakeSurveyResponse, truncateFakeResponses } from '@/lib/fake-data-generator';
import { parseBrowser } from '@/lib/operations/parse-ua';
import { normalizeToAnswers } from '@/lib/response-normalizer';
import type { Survey as SurveyClientType } from '@/types/survey';

// === 분포 상수 ===
const TOTAL_RECORDS = 30;
const COMPLETED_COUNT = 25;

const PLATFORM_DIST = { desktop: 18, mobile: 9, tablet: 3 } as const;
type PlatformKey = keyof typeof PLATFORM_DIST;

const UA_SAMPLES: Record<PlatformKey, string[]> = {
  desktop: [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    // Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
    // Safari on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  ],
  mobile: [
    // Safari on iPhone
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    // Chrome on Android
    'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ],
  tablet: [
    // Safari on iPad (legacy UA — iOS 13+ 기본은 desktop UA로 식별됨)
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ],
};

// === 헬퍼 ===
/** Box-Muller transform — 정규분포 난수 */
function gaussian(mean: number, std: number): number {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function pickPlatform(idx: number): PlatformKey {
  if (idx < PLATFORM_DIST.desktop) return 'desktop';
  if (idx < PLATFORM_DIST.desktop + PLATFORM_DIST.mobile) return 'mobile';
  return 'tablet';
}

function pickRandom<T>(arr: readonly T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error('pickRandom: empty array');
  return item;
}

interface RenderStep {
  kind: 'group' | 'table';
  id: string;
}

/** snapshot 의 groups + table questions 를 step 시퀀스로 변환 (단순 모방). */
function buildSteps(snapshot: SurveyVersionSnapshot): RenderStep[] {
  const steps: RenderStep[] = [];
  const sortedGroups = [...(snapshot.groups ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const g of sortedGroups) {
    steps.push({ kind: 'group', id: g.id });
  }
  const sortedQuestions = [...(snapshot.questions ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const q of sortedQuestions) {
    if (q.type === 'table') {
      steps.push({ kind: 'table', id: q.id });
    }
  }
  return steps;
}

interface VisitSimResult {
  visits: PageVisit[];
  totalSeconds: number;
  /** drop 시 마지막으로 방문한 step 의 인덱스 (0-based). completed 시 steps.length - 1. */
  lastVisitedIdx: number;
}

/** page_visits 시뮬레이션 — completed 는 끝까지, drop 은 50~80% 지점에서 멈춤. */
function buildPageVisits(
  steps: RenderStep[],
  startedAt: Date,
  status: 'completed' | 'drop',
): VisitSimResult {
  if (steps.length === 0) {
    return { visits: [], totalSeconds: 0, lastVisitedIdx: -1 };
  }

  const stopIdx =
    status === 'drop'
      ? Math.max(1, Math.floor(steps.length * (0.1 + Math.random() * 0.85)))
      : steps.length;

  const visits: PageVisit[] = [];
  let cursor = new Date(startedAt);

  for (let i = 0; i < stopIdx; i++) {
    const step = steps[i];
    if (!step) continue;
    const dwellSeconds = Math.max(5, Math.round(gaussian(60, 20)));
    const enteredAt = new Date(cursor);
    cursor = new Date(cursor.getTime() + dwellSeconds * 1000);

    visits.push({
      stepId: `${step.kind}:${step.id}`,
      enteredAt: enteredAt.toISOString(),
      leftAt: new Date(cursor).toISOString(),
    });
  }

  const totalSeconds = Math.floor((cursor.getTime() - startedAt.getTime()) / 1000);
  return { visits, totalSeconds, lastVisitedIdx: stopIdx - 1 };
}

// === production DB 가드 ===
const _isProd =
  process.env.NODE_ENV === 'production' ||
  !!process.env['SUPABASE_URL']?.includes('prod') ||
  !!process.env['DATABASE_URL']?.includes('prod');

if (_isProd && process.env['SEED_ALLOW_PROD'] !== 'true') {
  throw new Error(
    '[seed-fieldwork-mock] production DB 로 인식되는 환경에서는 실행 거부. ' +
      '명시적 opt-in 이 필요하면 SEED_ALLOW_PROD=true 환경변수 사용.',
  );
}
if (_isProd) {
  console.warn('[seed-fieldwork-mock] SEED_ALLOW_PROD=true 명시 opt-in 으로 실행됩니다.');
}

// === main ===
async function main() {
  const surveyId = process.argv[2];
  if (!surveyId) {
    throw new Error('usage: pnpm tsx scripts/seed-fieldwork-mock.ts <survey_id>');
  }

  // 1. 설문 + 현재 버전 로드
  const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
  if (!survey) throw new Error(`survey not found: ${surveyId}`);
  if (!survey.currentVersionId)
    throw new Error(`survey has no currentVersionId: ${surveyId}`);

  const [version] = await db
    .select()
    .from(surveyVersions)
    .where(eq(surveyVersions.id, survey.currentVersionId))
    .limit(1);
  if (!version) throw new Error(`version not found: ${survey.currentVersionId}`);

  const snapshot = version.snapshot;
  const steps = buildSteps(snapshot);
  if (steps.length === 0) {
    console.warn('⚠ snapshot has no groups or table questions — page_visits will be empty');
  }

  // 2. response_answers 정규화에 필요한 질문 메타
  const surveyQuestions = await db
    .select({ id: questions.id, type: questions.type })
    .from(questions)
    .where(eq(questions.surveyId, surveyId));

  // 3. fake-data-generator 가 기대하는 Survey 형태로 빌드
  //    (snapshot 의 questions/groups 가 client 의 Question/QuestionGroup 과 호환됨 — branch-logic 입력 형태와 동일.)
  const surveyForGenerator = {
    id: survey.id,
    title: survey.title,
    description: survey.description ?? undefined,
    questions: snapshot.questions,
    groups: snapshot.groups,
    settings: snapshot.settings,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
  } as unknown as SurveyClientType;

  // 4. 30건 레코드 빌드
  type SeedRecord = typeof surveyResponses.$inferInsert & {
    questionResponses: Record<string, unknown>;
  };
  const records: Array<SeedRecord & { _status: 'completed' | 'drop' }> = [];

  for (let i = 0; i < TOTAL_RECORDS; i++) {
    const platform = pickPlatform(i);
    const ua = pickRandom(UA_SAMPLES[platform]);
    const status: 'completed' | 'drop' = i < COMPLETED_COUNT ? 'completed' : 'drop';

    // 시작 일자: 최근 14일 균등 분포
    const daysAgo = (i / TOTAL_RECORDS) * 14;
    const jitterMs = Math.random() * 12 * 60 * 60 * 1000;
    const startedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - jitterMs);

    const { visits, totalSeconds: simSeconds, lastVisitedIdx } = buildPageVisits(steps, startedAt, status);

    // 응답시간 outlier (idx 0, 1 — completed 만): N(600, 200) 대신 4500/9000 추가
    let totalSeconds = simSeconds;
    if (status === 'completed' && i < 2) {
      totalSeconds = simSeconds + (i === 0 ? 4500 : 9000);
    } else if (status === 'completed') {
      // 시뮬값을 N(600, 200) 근방으로 살짝 보정 (시각 검증용 다양성)
      totalSeconds = Math.max(60, Math.round(gaussian(600, 200)));
    }

    const completedAt =
      status === 'completed'
        ? new Date(startedAt.getTime() + totalSeconds * 1000)
        : null;
    const lastActivityAt =
      completedAt ?? new Date(startedAt.getTime() + simSeconds * 1000);

    let questionResponses = generateFakeSurveyResponse(surveyForGenerator);

    // drop 응답: step 진행 비율을 question-level 비율로 변환해 잘라냄.
    // (실제 buildRenderSteps 가 group 인터리브이므로 step 단위 매핑 대신 비례적 자르기로 단순화 —
    // 각 응답의 last_question_id 가 다양한 위치에 분포하도록 한다.)
    if (status === 'drop' && lastVisitedIdx >= 0) {
      const stopRatio = (lastVisitedIdx + 1) / steps.length;
      const orderedQuestions = [...(snapshot.questions ?? [])].sort(
        (a, b) => ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0),
      );
      const stopAt = Math.max(
        1,
        Math.round(orderedQuestions.length * stopRatio),
      );
      const allowedIds = new Set(
        orderedQuestions.slice(0, stopAt).map((q) => (q as { id: string }).id),
      );
      questionResponses = truncateFakeResponses(questionResponses, allowedIds);
    }

    const sessionId = `seed-mock-${Date.now()}-${i}`;
    const lastVisit = visits[visits.length - 1];

    records.push({
      _status: status,
      surveyId,
      sessionId,
      versionId: survey.currentVersionId,
      questionResponses,
      isCompleted: status === 'completed',
      status,
      platform,
      browser: parseBrowser(ua),
      userAgent: ua,
      currentStepId: lastVisit?.stepId ?? null,
      pageVisits: visits,
      startedAt,
      completedAt,
      lastActivityAt,
      totalSeconds: status === 'completed' ? totalSeconds : null,
    });
  }

  // 5. INSERT
  const toInsert = records.map(({ _status, ...rest }) => rest);
  const inserted = await db
    .insert(surveyResponses)
    .values(toInsert)
    .returning({ id: surveyResponses.id });

  // 6. response_answers 정규화 (completed + drop 모두 포함)
  // drop 응답도 적재해야 drop-funnel 어댑터가 lastQuestionId 를 올바르게 읽을 수 있다.
  const orderedQuestionIds = (snapshot.questions as Array<{ id: string }>).map((q) => q.id);
  const questionOrder = new Map(orderedQuestionIds.map((id, idx) => [id, idx]));

  let normalizedRows = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const ins = inserted[i];
    if (!rec || !ins) continue;
    const normalized = normalizeToAnswers(
      ins.id,
      rec.questionResponses,
      surveyQuestions,
    );
    if (normalized.length === 0) continue;

    // snapshot.questions 순서로 정렬 후 startedAt ~ lastActivityAt 사이에 균등 점진 배치.
    // 이렇게 하면 drop 의 last created_at 이 마지막으로 답한 question 을 가리키게 된다.
    normalized.sort((a, b) => {
      const ai = questionOrder.get(a.questionId) ?? 999999;
      const bi = questionOrder.get(b.questionId) ?? 999999;
      return ai - bi;
    });

    const startMs = rec.startedAt!.getTime();
    const endMs = rec.lastActivityAt!.getTime();
    const span = (endMs - startMs) / Math.max(1, normalized.length);

    const withTimestamps = normalized.map((ra, idx) => ({
      ...ra,
      createdAt: new Date(startMs + (idx + 1) * span),
    }));

    await db.insert(responseAnswers).values(withTimestamps);
    normalizedRows += withTimestamps.length;
  }

  console.log(`✓ inserted ${inserted.length} mock responses for survey ${surveyId}`);
  console.log(`  - completed: ${records.filter((r) => r._status === 'completed').length}`);
  console.log(`  - drop:      ${records.filter((r) => r._status === 'drop').length}`);
  console.log(`  - response_answers rows: ${normalizedRows}`);
  console.log(`  - steps in snapshot: ${steps.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
