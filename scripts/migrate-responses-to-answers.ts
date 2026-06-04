/**
 * 응답 정규화 마이그레이션 스크립트
 *
 * 기존 survey_responses.questionResponses (JSONB) 데이터를
 * response_answers 테이블로 일괄 변환합니다.
 *
 * - 이미 response_answers가 있는 응답은 건너뜀 (멱등성)
 * - 트랜잭션 단위: 응답 1건씩 (대량 데이터 시 메모리 안전)
 * - DRY_RUN 모드로 미리보기 가능
 *
 * 사용법:
 *   tsx scripts/migrate-responses-to-answers.ts              # DRY RUN (미리보기)
 *   DRY_RUN=false tsx scripts/migrate-responses-to-answers.ts # 실제 반영
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('⚠️ .env.local 파일을 찾을 수 없습니다.');
}

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const DRY_RUN = process.env['DRY_RUN'] !== 'false';

interface QuestionRow {
  id: string;
  type: string;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  question_responses: Record<string, unknown>;
  is_completed: boolean;
}

interface AnswerInsert {
  response_id: string;
  question_id: string;
  text_value: string | null;
  array_value: unknown[] | null;
  object_value: Record<string, unknown> | null;
  question_type: string;
}

function normalizeValue(value: unknown, _questionType: string): Omit<AnswerInsert, 'response_id' | 'question_id' | 'question_type'> {
  if (typeof value === 'string') {
    return { text_value: value, array_value: null, object_value: null };
  }
  if (Array.isArray(value)) {
    return { text_value: null, array_value: value.map(String), object_value: null };
  }
  if (typeof value === 'object' && value !== null) {
    return { text_value: null, array_value: null, object_value: value as Record<string, unknown> };
  }
  return { text_value: null, array_value: null, object_value: null };
}

async function migrate() {
  console.log(`\n🚀 응답 정규화 마이그레이션 시작 (${DRY_RUN ? 'DRY RUN' : '실제 반영'})\n`);

  // 1. 완료된 응답 목록 조회
  const { data: responses, error: respError } = await supabase
    .from('survey_responses')
    .select('id, survey_id, question_responses, is_completed')
    .eq('is_completed', true)
    .order('created_at', { ascending: true });

  if (respError) {
    console.error('❌ 응답 조회 실패:', respError.message);
    process.exit(1);
  }

  console.log(`📊 완료된 응답: ${responses.length}건`);

  // 2. 이미 마이그레이션된 응답 확인
  const { data: existingAnswers, error: existError } = await supabase
    .from('response_answers')
    .select('response_id')
    .limit(10000);

  if (existError) {
    console.error('❌ 기존 답변 조회 실패:', existError.message);
    process.exit(1);
  }

  const migratedResponseIds = new Set(
    (existingAnswers || []).map((a: { response_id: string }) => a.response_id),
  );
  console.log(`✅ 이미 마이그레이션된 응답: ${migratedResponseIds.size}건`);

  // 3. 설문별 질문 캐시
  const questionCache = new Map<string, Map<string, string>>();

  async function getQuestionMap(surveyId: string): Promise<Map<string, string>> {
    if (questionCache.has(surveyId)) return questionCache.get(surveyId)!;

    const { data: questionRows, error } = await supabase
      .from('questions')
      .select('id, type')
      .eq('survey_id', surveyId);

    if (error) {
      console.error(`❌ 질문 조회 실패 (survey: ${surveyId}):`, error.message);
      return new Map();
    }

    const map = new Map((questionRows || []).map((q: QuestionRow) => [q.id, q.type]));
    questionCache.set(surveyId, map);
    return map;
  }

  // 4. 변환 실행
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const response of responses as ResponseRow[]) {
    // 이미 마이그레이션된 응답 건너뜀
    if (migratedResponseIds.has(response.id)) {
      skippedCount++;
      continue;
    }

    const questionResponses = response.question_responses;
    if (!questionResponses || Object.keys(questionResponses).length === 0) {
      skippedCount++;
      continue;
    }

    const questionMap = await getQuestionMap(response.survey_id);
    const answersToInsert: AnswerInsert[] = [];

    for (const [questionId, value] of Object.entries(questionResponses)) {
      if (value === null || value === undefined) continue;

      const questionType = questionMap.get(questionId);
      if (!questionType) continue;

      const normalized = normalizeValue(value, questionType);
      // 모든 값이 null이면 건너뜀
      if (normalized.text_value === null && normalized.array_value === null && normalized.object_value === null) {
        continue;
      }

      answersToInsert.push({
        response_id: response.id,
        question_id: questionId,
        question_type: questionType,
        ...normalized,
      });
    }

    if (answersToInsert.length === 0) {
      skippedCount++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] 응답 ${response.id.slice(0, 8)}... → ${answersToInsert.length}행 생성 예정`);
      migratedCount++;
      continue;
    }

    // 실제 INSERT
    const { error: insertError } = await supabase
      .from('response_answers')
      .insert(answersToInsert);

    if (insertError) {
      console.error(`  ❌ 응답 ${response.id.slice(0, 8)}... INSERT 실패:`, insertError.message);
      errorCount++;
    } else {
      migratedCount++;
    }
  }

  console.log(`\n📋 마이그레이션 결과:`);
  console.log(`  ✅ 변환 완료: ${migratedCount}건`);
  console.log(`  ⏭️  건너뜀: ${skippedCount}건`);
  console.log(`  ❌ 에러: ${errorCount}건`);

  if (DRY_RUN) {
    console.log(`\n💡 실제 반영하려면: DRY_RUN=false tsx scripts/migrate-responses-to-answers.ts`);
  }
}

migrate().catch(console.error);
