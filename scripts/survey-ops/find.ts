/**
 * 문구로 문항 찾기 — 화면 캡처나 「문 7 그 표」처럼 설문 id 를 모르는 채로 시작할 때.
 *
 *   pnpm survey:find '<문구>' --env prod [--limit 20]
 *
 * 문항 제목·설명·문항 코드·보기·표 칸 글자에서 부분 일치(대소문자 무시)로 찾아 설문별로 묶어 낸다.
 * 설문 id · 문항 id · 코드 · 유형과, 그 설문의 발행 여부·응답 수를 함께 낸다 — 뒤이어 `survey:vars`·
 * `survey:dump`·패치 도우미에 넘길 값이다. 읽기 전용 트랜잭션에서만 읽는다(풀러에 세션 SET 을 남기지 않는다).
 */
import path from 'node:path';

import { exitWithError, loadOpsEnv, parseOpsArgs } from './env';

/** ILIKE 패턴 — 찾는 글자의 `%`·`_`·`\` 는 글자 그대로 찾는다. */
export function likePattern(phrase: string): string {
  return `%${phrase.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export interface FoundQuestion {
  surveyId: string;
  surveyTitle: string;
  surveyStatus: string;
  published: boolean;
  questionId: string;
  questionCode: string | null;
  type: string;
  title: string;
  /** 어디에서 걸렸는가 — 제목·설명·코드·보기·표 칸 */
  matched: string[];
  updatedAt: string;
}

export interface SurveyResponseCount {
  surveyId: string;
  status: string;
  isTest: boolean;
  n: number;
}

const shorten = (text: string, max = 70) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** 설문별로 묶어 사람이 읽을 줄로 편다. */
export function formatFound(found: FoundQuestion[], counts: SurveyResponseCount[]): string {
  if (found.length === 0) return '찾은 문항이 없습니다';
  const bySurvey = new Map<string, FoundQuestion[]>();
  for (const q of found) bySurvey.set(q.surveyId, [...(bySurvey.get(q.surveyId) ?? []), q]);
  const lines: string[] = [];
  for (const [surveyId, questions] of bySurvey) {
    const first = questions[0]!;
    const own = counts.filter((c) => c.surveyId === surveyId);
    const tally = (isTest: boolean) =>
      own
        .filter((c) => c.isTest === isTest)
        .map((c) => `${c.status} ${c.n}`)
        .join(' · ') || '없음';
    lines.push(
      `■ ${shorten(first.surveyTitle)} — ${first.surveyStatus} · ${first.published ? '발행본 있음' : '발행 전'}`,
      `  설문 id ${surveyId}`,
      `  실응답 ${tally(false)} / 테스트 ${tally(true)}`,
    );
    for (const q of questions) {
      lines.push(
        `  - ${q.questionCode ?? '(코드 없음)'} · ${q.type} · ${q.matched.join('·')} 일치 · ${q.updatedAt.slice(0, 10)} 수정`,
        `    문항 id ${q.questionId}`,
        `    ${shorten(q.title)}`,
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = parseOpsArgs(process.argv.slice(2));
  const phrase = args.positionals[0]?.trim();
  if (!phrase) throw new Error("찾을 문구를 적어 주세요: pnpm survey:find '<문구>' --env prod");
  const limitFlag = args.flags.get('limit');
  const limit = typeof limitFlag === 'string' ? Number(limitFlag) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error('--limit 은 1~200 의 정수여야 합니다');

  const { host, file: envSource } = loadOpsEnv(args.env);
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const pattern = likePattern(phrase);

  const { found, counts } = await db.transaction(
    async (tx) => {
      const rows = await tx.execute<{
        survey_id: string;
        survey_title: string;
        survey_status: string;
        published: boolean;
        question_id: string;
        question_code: string | null;
        type: string;
        title: string;
        in_title: boolean;
        in_description: boolean;
        in_code: boolean;
        in_options: boolean;
        in_table: boolean;
        updated_at: Date | string;
      }>(sql`
        select q.survey_id, s.title as survey_title, s.status as survey_status,
               s.current_version_id is not null as published,
               q.id as question_id, q.question_code, q.type, q.title,
               q.title ilike ${pattern} as in_title,
               coalesce(q.description ilike ${pattern}, false) as in_description,
               coalesce(q.question_code ilike ${pattern}, false) as in_code,
               coalesce(q.options::text ilike ${pattern}, false) as in_options,
               coalesce(q.table_rows_data::text ilike ${pattern}, false) as in_table,
               q.updated_at
        from questions q join surveys s on s.id = q.survey_id
        where q.title ilike ${pattern}
           or q.description ilike ${pattern}
           or q.question_code ilike ${pattern}
           or q.options::text ilike ${pattern}
           or q.table_rows_data::text ilike ${pattern}
        order by q.updated_at desc
        limit ${limit}
      `);
      const found: FoundQuestion[] = [...rows].map((r) => ({
        surveyId: r.survey_id,
        surveyTitle: r.survey_title,
        surveyStatus: r.survey_status,
        published: r.published,
        questionId: r.question_id,
        questionCode: r.question_code,
        type: r.type,
        title: r.title,
        matched: [
          r.in_title ? '제목' : '',
          r.in_description ? '설명' : '',
          r.in_code ? '코드' : '',
          r.in_options ? '보기' : '',
          r.in_table ? '표 칸' : '',
        ].filter(Boolean),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
      const surveyIds = [...new Set(found.map((q) => q.surveyId))];
      const counts: SurveyResponseCount[] =
        surveyIds.length === 0
          ? []
          : [
              ...(await tx.execute<{
                survey_id: string;
                status: string;
                is_test: boolean;
                n: number;
              }>(sql`
                select survey_id, status, is_test, count(*)::int as n
                from survey_responses
                where survey_id in (${sql.join(
                  surveyIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})
                group by 1, 2, 3
                order by 1, 3, 2
              `)),
            ].map((r) => ({ surveyId: r.survey_id, status: r.status, isTest: r.is_test, n: r.n }));
      return { found, counts };
    },
    { accessMode: 'read only' },
  );

  console.log(`${args.env} (${host} · ${envSource}) · 「${phrase}」`);
  console.log(
    `문항 ${found.length}개${found.length === limit ? ` (상한 ${limit} — 더 있을 수 있습니다. --limit 으로 늘리세요)` : ''}`,
  );
  console.log(formatFound(found, counts));
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('survey-ops', 'find.ts'))) {
  main().then(
    () => process.exit(0),
    (err: unknown) => exitWithError(err),
  );
}
