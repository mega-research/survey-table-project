/**
 * Dev only — 쿼터 테스트용 mock 응답 대량 INSERT (기본 500건).
 *
 * 실행: pnpm tsx scripts/seed-quota-mock.ts <survey_id> [total] [--reset]
 *   --reset: 해당 설문의 기존 시드(session_id LIKE 'seed-quota-%')를 먼저 삭제하고 새로 삽입.
 *
 * 시간 배치: 삽입 순서 = 시간 오름차순 (마지막 순번이 가장 최근).
 *   완료/이탈은 섞어서 지난 14일에 깔고, 진행중은 최근 3시간에 몰아 목록 끝에 온다.
 *
 * 동작:
 *   - surveys.quota_config 를 읽어 완료 응답의 인구통계(쿼터 조건 문항)를 셀 단위로 배분.
 *     · 목표가 있는 셀 일부(약 60%)는 정확히 목표까지 채워 "마감" 상태를 만들고,
 *       나머지는 20~85% 부분 충족(순조/주의/부족 톤 검증용). 목표 초과 금지.
 *     · 남는 완료 응답은 목표 미설정(무제한) 조합 — 다른 지역/연령 조합으로 배분.
 *     · 기존 완료 응답도 tally 에 포함해 초과 방지.
 *   - status 분포: completed 400 / in_progress 40 / drop 60 (총 500 기준 비례).
 *   - 응답 내역은 fake-data-generator 로 생성 (displayCondition·분기·테이블 검증 준수).
 *     쿼터 조건 문항은 배분된 셀의 보기로 강제(해당 보기만 남긴 설문 사본으로 생성).
 *   - 텍스트 문항은 제목 키워드 기반 시맨틱 응답(성명/전화/병원/가구원 수 등).
 *   - page_visits / totalSeconds / progressPct / response_answers 정규화 포함
 *     (seed-fieldwork-mock.ts 와 동일 패턴).
 *
 * NOTE: production DB에 직접 적용 금지. dev/staging 시각 검증용.
 */
// import 호이스팅 때문에 side-effect import 로 @/db 평가 전에 env 를 주입한다 (seed-fieldwork-mock 과 동일).
import 'dotenv/config';

import { and, eq, inArray, isNull, like } from 'drizzle-orm';

import { db } from '@/db';
import { questions, responseAnswers, surveyResponses, surveyVersions, surveys } from '@/db/schema';
import type { PageVisit, QuotaConfig, SurveyVersionSnapshot } from '@/db/schema/schema-types';
import { generateFakeSurveyResponse } from '@/lib/fake-data-generator';
import { parseBrowser } from '@/lib/operations/parse-ua';
import { cellKeyOf, tallyAll } from '@/lib/quota/matching';
import { normalizeToAnswers } from '@/lib/response-normalizer';
import type { Question, Survey as SurveyClientType } from '@/types/survey';

// === 분포 상수 (total 에 비례 스케일) ===
const DEFAULT_TOTAL = 500;
const COMPLETED_RATIO = 0.8; // 400
const IN_PROGRESS_RATIO = 0.08; // 40 — 나머지는 drop

const PLATFORM_DIST = { desktop: 0.6, mobile: 0.3, tablet: 0.1 } as const;
type PlatformKey = keyof typeof PLATFORM_DIST;

const UA_SAMPLES: Record<PlatformKey, string[]> = {
  desktop: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  ],
  mobile: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ],
  tablet: [
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ],
};

const FAKE_NAMES = [
  '김민준', '이서연', '박지훈', '최수아', '정예준', '강하은',
  '조우진', '윤지민', '임서준', '한소율', '오도윤', '서지우',
];
const HOSPITAL_ANSWERS = ['안동병원', '경북대학교병원', '안동병원(권역센터)', '잘 모르겠다'];

// === 헬퍼 ===
function gaussian(mean: number, std: number): number {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function pickRandom<T>(arr: readonly T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error('pickRandom: empty array');
  return item;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}

function pickPlatform(): PlatformKey {
  const r = Math.random();
  if (r < PLATFORM_DIST.desktop) return 'desktop';
  if (r < PLATFORM_DIST.desktop + PLATFORM_DIST.mobile) return 'mobile';
  return 'tablet';
}

interface RenderStep {
  kind: 'group' | 'table';
  id: string;
}

/** snapshot 의 groups + table questions 를 step 시퀀스로 변환 (seed-fieldwork-mock 과 동일). */
function buildSteps(snapshot: SurveyVersionSnapshot): RenderStep[] {
  const steps: RenderStep[] = [];
  const sortedGroups = [...(snapshot.groups ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const g of sortedGroups) steps.push({ kind: 'group', id: g.id });
  const sortedQuestions = [...(snapshot.questions ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const q of sortedQuestions) {
    if (q.type === 'table') steps.push({ kind: 'table', id: q.id });
  }
  return steps;
}

interface VisitSimResult {
  visits: PageVisit[];
  totalSeconds: number;
  lastVisitedIdx: number;
  /** 진행 비율 (0~1) — drop/in_progress 응답 자르기와 progressPct 에 사용 */
  ratio: number;
}

function buildPageVisits(
  steps: RenderStep[],
  startedAt: Date,
  status: 'completed' | 'drop' | 'in_progress',
): VisitSimResult {
  if (steps.length === 0) return { visits: [], totalSeconds: 0, lastVisitedIdx: -1, ratio: 1 };

  const stopIdx =
    status === 'completed'
      ? steps.length
      : Math.max(1, Math.floor(steps.length * (0.1 + Math.random() * 0.85)));

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
  return { visits, totalSeconds, lastVisitedIdx: stopIdx - 1, ratio: stopIdx / steps.length };
}

/** 제목 키워드 기반 시맨틱 텍스트 응답 — "테스트 응답 N" 기본값을 문항에 어울리게 교체. */
function semanticTextAnswer(q: Question): string {
  const title = q.title ?? '';
  if (/성명|이름/.test(title)) return pickRandom(FAKE_NAMES);
  if (/전화|연락처/.test(title)) {
    const mid = 1000 + Math.floor(Math.random() * 9000);
    const tail = 1000 + Math.floor(Math.random() * 9000);
    return `010-${mid}-${tail}`;
  }
  if (/병원|센터/.test(title)) return pickRandom(HOSPITAL_ANSWERS);
  if (q.inputType === 'number' || /몇 명|인원/.test(title)) {
    return String(1 + Math.floor(Math.random() * 4)); // 가구원 수 등 1~4
  }
  if (q.type === 'textarea') return '특별한 의견은 없습니다. 조사 취지에 공감합니다.';
  return '해당 없음';
}

// === production DB 가드 (seed-fieldwork-mock 과 동일) ===
const _isProd =
  process.env.NODE_ENV === 'production' ||
  !!process.env['SUPABASE_URL']?.includes('prod') ||
  !!process.env['DATABASE_URL']?.includes('prod');

if (_isProd && process.env['SEED_ALLOW_PROD'] !== 'true') {
  throw new Error(
    '[seed-quota-mock] production DB 로 인식되는 환경에서는 실행 거부. ' +
      '명시적 opt-in 이 필요하면 SEED_ALLOW_PROD=true 환경변수 사용.',
  );
}

// === 쿼터 배분 계획 ===
interface CellAssignment {
  /** dimension 순서의 categoryIds. null 이면 쿼터 미분류(무제한 조합). */
  categoryIds: string[];
}

/**
 * 완료 응답 수만큼 셀 배분 목록 생성.
 * - 목표 셀 60% → 남은 목표를 전부 채움(마감), 40% → 20~85% 부분 충족.
 * - 남는 수량 → 목표가 없는 조합(다른 지역 등, 무제한)에 균등 랜덤 배분.
 */
function planAssignments(
  config: QuotaConfig,
  existingTally: Map<string, number>,
  completedCount: number,
): { assignments: string[][]; fullCells: number; partialCells: number; unlimited: number } {
  const assignments: string[][] = [];

  // 1) 목표 셀별 남은 수량
  const cellsWithRemaining = config.cells
    .map((c) => ({
      categoryIds: c.categoryIds,
      remaining: Math.max(0, c.target - (existingTally.get(cellKeyOf(c.categoryIds)) ?? 0)),
    }))
    .filter((c) => c.remaining > 0);

  shuffle(cellsWithRemaining);
  const fullCount = Math.round(cellsWithRemaining.length * 0.6);

  let budget = completedCount;
  let fullCells = 0;
  let partialCells = 0;

  cellsWithRemaining.forEach((cell, idx) => {
    if (budget <= 0) return;
    const isFull = idx < fullCount;
    const want = isFull
      ? cell.remaining
      : Math.max(1, Math.round(cell.remaining * (0.2 + Math.random() * 0.65)));
    const take = Math.min(want, budget, cell.remaining); // 목표 초과 절대 금지
    for (let i = 0; i < take; i++) assignments.push(cell.categoryIds);
    budget -= take;
    if (take === cell.remaining) fullCells += 1;
    else if (take > 0) partialCells += 1;
  });

  // 2) 남는 수량 → 목표 미설정 조합 (무제한 — 마감 불가). "다른 지역으로" 흘려보내는 부분.
  const configuredKeys = new Set(config.cells.map((c) => cellKeyOf(c.categoryIds)));
  const allCombos: string[][] = config.dimensions.reduce<string[][]>(
    (acc, dim) => acc.flatMap((ids) => dim.categories.map((cat) => [...ids, cat.id])),
    [[]],
  );
  const unlimitedCombos = allCombos.filter((ids) => !configuredKeys.has(cellKeyOf(ids)));
  const unlimited = budget;
  for (let i = 0; i < unlimited; i++) {
    assignments.push(pickRandom(unlimitedCombos));
  }

  return { assignments: shuffle(assignments), fullCells, partialCells, unlimited };
}

// === main ===
async function main() {
  const surveyId = process.argv[2];
  const total = Number(process.argv[3] ?? DEFAULT_TOTAL);
  if (!surveyId || !Number.isFinite(total) || total < 10) {
    throw new Error('usage: pnpm tsx scripts/seed-quota-mock.ts <survey_id> [total>=10]');
  }

  const completedCount = Math.round(total * COMPLETED_RATIO);
  const inProgressCount = Math.round(total * IN_PROGRESS_RATIO);
  const dropCount = total - completedCount - inProgressCount;

  // 0. --reset: 기존 시드 삭제 (response_answers → survey_responses 순, 시드 외 응답은 보존)
  if (process.argv.includes('--reset')) {
    const seedIds = db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(
        and(eq(surveyResponses.surveyId, surveyId), like(surveyResponses.sessionId, 'seed-quota-%')),
      );
    await db.delete(responseAnswers).where(inArray(responseAnswers.responseId, seedIds));
    const deleted = await db
      .delete(surveyResponses)
      .where(
        and(eq(surveyResponses.surveyId, surveyId), like(surveyResponses.sessionId, 'seed-quota-%')),
      )
      .returning({ id: surveyResponses.id });
    console.log(`- reset: 기존 시드 ${deleted.length}건 삭제`);
  }

  // 1. 설문 + 버전 + 쿼터 설정 로드
  const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
  if (!survey) throw new Error(`survey not found: ${surveyId}`);
  if (!survey.currentVersionId) throw new Error(`survey has no currentVersionId: ${surveyId}`);
  const config = survey.quotaConfig;
  if (!config || config.dimensions.length === 0) {
    throw new Error('quota_config 가 없습니다 — 쿼터 조건을 먼저 설정하세요.');
  }

  const [version] = await db
    .select()
    .from(surveyVersions)
    .where(eq(surveyVersions.id, survey.currentVersionId))
    .limit(1);
  if (!version) throw new Error(`version not found: ${survey.currentVersionId}`);
  const snapshot = version.snapshot;
  const steps = buildSteps(snapshot);

  // 2. 기존 완료 응답 tally — 목표 초과 방지 기준선
  const existingRows = await db
    .select({ questionResponses: surveyResponses.questionResponses })
    .from(surveyResponses)
    // data/response-filters 의 completedResponse/notDeletedResponse 와 동일 조건
    // ('server-only' import 라 스크립트에서 직접 가져올 수 없어 인라인).
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.status, 'completed'),
        isNull(surveyResponses.deletedAt),
      ),
    );
  const existingTally = tallyAll(
    config,
    existingRows.map((r) => (r.questionResponses ?? {}) as Record<string, unknown>),
  );

  // 3. 완료 응답 셀 배분 계획
  const plan = planAssignments(config, existingTally, completedCount);

  // 4. 인구통계 강제용 — 카테고리 id → 보기 value 매핑
  const categoryValue = new Map<string, string>();
  for (const dim of config.dimensions) {
    for (const cat of dim.categories) {
      const v = cat.values?.[0];
      if (v !== undefined) categoryValue.set(`${dim.id}:${cat.id}`, v);
    }
  }

  /** 배분된 셀 → {questionId: 강제 보기값}. */
  function forcedAnswersOf(categoryIds: string[]): Record<string, string> {
    const forced: Record<string, string> = {};
    config!.dimensions.forEach((dim, di) => {
      const catId = categoryIds[di];
      if (!catId) return;
      const v = categoryValue.get(`${dim.id}:${catId}`);
      if (v !== undefined) forced[dim.questionId] = v;
    });
    return forced;
  }

  const snapshotQuestions = (snapshot.questions ?? []) as Question[];
  const questionById = new Map(snapshotQuestions.map((q) => [q.id, q]));

  /** 쿼터 조건 문항의 보기를 강제값 하나로 줄인 설문 사본 — 생성기가 반드시 그 보기를 고른다. */
  function surveyForGenerator(forced: Record<string, string>): SurveyClientType {
    const qs = snapshotQuestions.map((q) => {
      const forcedValue = forced[q.id];
      if (forcedValue === undefined || !Array.isArray(q.options)) return q;
      const kept = q.options.filter((o) => o.value === forcedValue);
      return kept.length > 0 ? { ...q, options: kept } : q;
    });
    return {
      id: survey!.id,
      title: survey!.title,
      description: survey!.description ?? undefined,
      questions: qs,
      groups: snapshot.groups,
      settings: snapshot.settings,
      createdAt: survey!.createdAt,
      updatedAt: survey!.updatedAt,
    } as unknown as SurveyClientType;
  }

  // 5. response_answers 정규화용 질문 메타
  const surveyQuestions = await db
    .select({ id: questions.id, type: questions.type })
    .from(questions)
    .where(eq(questions.surveyId, surveyId));

  // 6. 레코드 빌드
  type SeedRecord = typeof surveyResponses.$inferInsert & {
    questionResponses: Record<string, unknown>;
  };
  const records: SeedRecord[] = [];
  const seedTag = Date.now();

  // 순번 = 시간 오름차순. 완료/이탈은 섞어서 14일 구간에, 진행중은 최근 3시간(목록 끝)에 배치.
  const statuses: Array<'completed' | 'in_progress' | 'drop'> = [
    ...shuffle([
      ...Array.from({ length: completedCount }, () => 'completed' as const),
      ...Array.from({ length: dropCount }, () => 'drop' as const),
    ]),
    ...Array.from({ length: inProgressCount }, () => 'in_progress' as const),
  ];
  const coreCount = completedCount + dropCount;
  const HOUR_MS = 60 * 60 * 1000;
  const CORE_SPAN_MS = 14 * 24 * HOUR_MS - 3 * HOUR_MS; // 14일 전 ~ 3시간 전
  const seedNow = Date.now();

  const orderedQuestions = [...snapshotQuestions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  let assignIdx = 0;
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    if (!status) continue;
    const platform = pickPlatform();
    const ua = pickRandom(UA_SAMPLES[platform]);

    // 인구통계: 완료 = 쿼터 배분 계획, 진행중/이탈 = 임의 조합 (집계에 안 잡힘)
    const categoryIds =
      status === 'completed'
        ? (plan.assignments[assignIdx++] ??
          plan.assignments[plan.assignments.length - 1] ??
          [])
        : config.dimensions.map((d) => pickRandom(d.categories).id);
    const forced = forcedAnswersOf(categoryIds);

    // 시작 시각: 삽입 순서대로 오름차순 — 마지막 순번이 가장 최근.
    // completed/drop 은 [14일 전, 3시간 전] 구간, in_progress 는 [3시간 전, 10분 전] 구간.
    const startedAt =
      status === 'in_progress'
        ? new Date(
            seedNow -
              3 * HOUR_MS +
              ((i - coreCount + Math.random()) / Math.max(1, inProgressCount)) *
                (3 * HOUR_MS - 10 * 60 * 1000),
          )
        : new Date(seedNow - 14 * 24 * HOUR_MS + ((i + Math.random()) / coreCount) * CORE_SPAN_MS);

    const sim = buildPageVisits(steps, startedAt, status);

    // 전체 응답 생성 후 상태별 진행 지점까지 절단
    let questionResponses: Record<string, unknown> = generateFakeSurveyResponse(
      surveyForGenerator(forced),
    );
    // 강제 인구통계 최종 보증 (생성기 경로와 무관하게 셀 일치 유지)
    for (const [qid, v] of Object.entries(forced)) questionResponses[qid] = v;

    // 텍스트 문항 시맨틱 응답 교체
    for (const qid of Object.keys(questionResponses)) {
      const q = questionById.get(qid);
      if (q && (q.type === 'text' || q.type === 'textarea')) {
        questionResponses[qid] = semanticTextAnswer(q);
      }
    }

    if (status !== 'completed') {
      const stopAt = Math.max(1, Math.round(orderedQuestions.length * sim.ratio));
      const allowedIds = new Set(orderedQuestions.slice(0, stopAt).map((q) => q.id));
      questionResponses = Object.fromEntries(
        Object.entries(questionResponses).filter(([qid]) => allowedIds.has(qid)),
      );
    }

    const totalSeconds =
      status === 'completed' ? Math.max(60, Math.round(gaussian(600, 200))) : sim.totalSeconds;
    const completedAt =
      status === 'completed' ? new Date(startedAt.getTime() + totalSeconds * 1000) : null;
    const lastActivityAt =
      status === 'in_progress'
        ? new Date(Math.min(seedNow - 60 * 1000, startedAt.getTime() + sim.totalSeconds * 1000))
        : (completedAt ?? new Date(startedAt.getTime() + sim.totalSeconds * 1000));
    const lastVisit = sim.visits[sim.visits.length - 1];

    records.push({
      surveyId,
      sessionId: `seed-quota-${seedTag}-${i}`,
      versionId: survey.currentVersionId,
      questionResponses,
      isCompleted: status === 'completed',
      status,
      platform,
      browser: parseBrowser(ua),
      userAgent: ua,
      currentStepId: lastVisit?.stepId ?? null,
      pageVisits: sim.visits,
      startedAt,
      completedAt,
      lastActivityAt,
      totalSeconds: status === 'completed' ? totalSeconds : null,
      progressPct: status === 'completed' ? 100 : Math.round(sim.ratio * 100),
      // 순번 정렬 기준이 createdAt 이어도 시간순이 유지되도록 시작 시각과 일치시킨다.
      createdAt: startedAt,
    });
  }

  // 7. INSERT (100건 단위 청크)
  const insertedIds: string[] = [];
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const inserted = await db
      .insert(surveyResponses)
      .values(chunk)
      .returning({ id: surveyResponses.id });
    insertedIds.push(...inserted.map((r) => r.id));
  }

  // 8. response_answers 정규화 (전 상태 포함 — drop-funnel 이 lastQuestionId 를 읽는다)
  const questionOrder = new Map(orderedQuestions.map((q, idx) => [q.id, idx]));
  let answerRows: Array<typeof responseAnswers.$inferInsert> = [];
  let normalizedRows = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const responseId = insertedIds[i];
    if (!rec || !responseId) continue;
    const normalized = normalizeToAnswers(responseId, rec.questionResponses, surveyQuestions);
    if (normalized.length === 0) continue;

    normalized.sort(
      (a, b) => (questionOrder.get(a.questionId) ?? 999999) - (questionOrder.get(b.questionId) ?? 999999),
    );
    const startMs = (rec.startedAt as Date).getTime();
    const endMs = (rec.lastActivityAt as Date).getTime();
    const span = (endMs - startMs) / Math.max(1, normalized.length);
    answerRows.push(
      ...normalized.map((ra, idx) => ({ ...ra, createdAt: new Date(startMs + (idx + 1) * span) })),
    );

    if (answerRows.length >= 500) {
      await db.insert(responseAnswers).values(answerRows);
      normalizedRows += answerRows.length;
      answerRows = [];
    }
  }
  if (answerRows.length > 0) {
    await db.insert(responseAnswers).values(answerRows);
    normalizedRows += answerRows.length;
  }

  console.log(`✓ inserted ${insertedIds.length} mock responses for survey ${surveyId}`);
  console.log(`  - completed:   ${completedCount} (마감 셀 ${plan.fullCells} / 부분 충족 셀 ${plan.partialCells} / 무제한 조합 ${plan.unlimited})`);
  console.log(`  - in_progress: ${inProgressCount}`);
  console.log(`  - drop:        ${dropCount}`);
  console.log(`  - response_answers rows: ${normalizedRows}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
