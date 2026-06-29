/**
 * 옵션 단위 텍스트 입력 마이그레이션 runner.
 *
 * 사용법:
 *   pnpm tsx scripts/migrate-option-text.ts --dry-run    # 검증만 (기본)
 *   pnpm tsx scripts/migrate-option-text.ts --apply      # 실제 적용
 *
 * idempotent: 이미 변환된 데이터(allowOtherOption=false 이거나 없음)는 skip.
 *
 * 3단계 마이그레이션:
 *  1. questions 테이블 — allow_other_option=true 질문에 "기타" 옵션 append
 *  2. survey_versions.snapshot JSONB — 발행된 스냅샷 안 질문/테이블셀 변환
 *  3. survey_responses.question_responses JSONB — 기존 응답의 __other__ + otherInputs 변환
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, isNotNull } from 'drizzle-orm';
import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import type { SurveyVersionSnapshot } from '../src/db/schema/schema-types';
import type { LegacyResponseShape } from '../src/lib/option-text-migration';
import {
  migrateQuestionOptions,
  migrateSnapshotQuestions,
  migrateResponseValue,
} from '../src/lib/option-text-migration';
import * as schema from '../src/db/schema';

// .env.local 로드 (로컬 개발 환경)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const isDryRun = !process.argv.includes('--apply');

type JsonRecord = Record<string, unknown>;
type OtherInput = NonNullable<LegacyResponseShape['otherInputs']>[number];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOtherInputs(value: unknown): OtherInput[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const entries = value.filter(
    (entry): entry is OtherInput =>
      isRecord(entry) &&
      typeof entry['optionId'] === 'string' &&
      typeof entry['inputValue'] === 'string',
  );
  return entries.length > 0 ? entries : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isOtherTokenEntry(value: unknown): boolean {
  return value === '__other__' || (isRecord(value) && value['optionValue'] === '__other__');
}

function toLegacyResponseShape(questionId: string, raw: unknown): LegacyResponseShape {
  if (!isRecord(raw)) {
    return { questionId, value: raw };
  }

  const otherInputs = parseOtherInputs(raw['otherInputs']);
  const optionTexts = parseStringRecord(raw['optionTexts']);

  return {
    questionId,
    value: raw['value'],
    ...(otherInputs ? { otherInputs } : {}),
    ...(optionTexts ? { optionTexts } : {}),
  };
}

async function main() {
  const sqlClient = postgres(DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  console.log(isDryRun ? '[DRY-RUN]' : '[APPLY]', '옵션 텍스트 마이그레이션 시작');

  let questionsMigrated = 0;
  let snapshotsMigrated = 0;
  let responsesMigrated = 0;
  let tableCellsMigrated = 0;
  let unhandledOther = 0; // 매핑 누락 등으로 처리 못한 __other__ 카운트

  try {
    await db.transaction(async tx => {
      // Step 1: questions 테이블 — allow_other_option=true
      const questionsToMigrate = await tx
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.allowOtherOption, true));

      console.log(`찾음: questions ${questionsToMigrate.length} 개`);

      for (const q of questionsToMigrate) {
        const migrated = migrateQuestionOptions({
          id: q.id,
          allowOtherOption: q.allowOtherOption ?? false,
          options: q.options ?? [],
        });
        if (!migrated.migratedOtherOptionId) continue;
        if (!isDryRun) {
          await tx
            .update(schema.questions)
            .set({
              options: migrated.options,
              allowOtherOption: false,
            })
            .where(eq(schema.questions.id, q.id));
        }
        questionsMigrated++;
      }

      // Step 2: survey_versions.snapshot
      // versionId 가 연결된 응답만 매핑에 활용하므로 모든 버전을 스캔
      const versions = await tx
        .select()
        .from(schema.surveyVersions)
        .where(isNotNull(schema.surveyVersions.snapshot));

      console.log(`스캔: survey_versions ${versions.length} 개`);

      // versionId -> mapping 저장 (Step 3에서 응답 변환에 사용)
      const versionMappings: Record<
        string,
        {
          questionMap: Record<string, Record<string, string>>;
          cellMap: Record<string, Record<string, Record<string, string>>>;
        }
      > = {};

      for (const version of versions) {
        const snapshot = version.snapshot;
        if (!Array.isArray(snapshot.questions)) continue;

        const hasOther = snapshot.questions.some(
          q =>
            q.allowOtherOption ||
            q.tableRowsData?.some(row =>
              row.cells?.some(cell => cell.allowOtherOption),
            ),
        );
        if (!hasOther) continue;

        const result = migrateSnapshotQuestions(snapshot);
        versionMappings[version.id] = {
          questionMap: result.otherIdMappings,
          cellMap: result.cellOtherIdMappings,
        };

        if (!isDryRun) {
          await tx
            .update(schema.surveyVersions)
            .set({
              snapshot: {
                ...snapshot,
                questions: result.questions as SurveyVersionSnapshot['questions'],
              },
            })
            .where(eq(schema.surveyVersions.id, version.id));
        }
        snapshotsMigrated++;
      }

      console.log(`변환 대상: survey_versions ${snapshotsMigrated} 개`);

      // Step 3: survey_responses.question_responses
      // versionId 가 있는 응답만 처리 (snapshot 기반 매핑 필요)
      const responses = await tx
        .select()
        .from(schema.surveyResponses)
        .where(isNotNull(schema.surveyResponses.versionId));

      console.log(`스캔: survey_responses ${responses.length} 개`);

      for (const resp of responses) {
        const qResponses = isRecord(resp.questionResponses) ? resp.questionResponses : null;
        if (!qResponses) continue;

        const versionId = resp.versionId;
        if (!versionId) continue;

        const mapping = versionMappings[versionId];
        if (!mapping) continue;

        let changed = false;
        const newQResponses: Record<string, unknown> = {};

        for (const [questionId, value] of Object.entries(qResponses)) {
          const questionMapping = mapping.questionMap[questionId] ?? {};
          const cellMapping = mapping.cellMap[questionId];
          const oldShape = value;
          const oldShapeRecord = isRecord(oldShape) ? oldShape : null;
          const oldValue = oldShapeRecord?.['value'];

          // 케이스 1: top-level 응답 (radio/checkbox/select)
          const hasOtherInputs =
            Array.isArray(oldShapeRecord?.['otherInputs']) && oldShapeRecord['otherInputs'].length > 0;
          const hasOtherMagic =
            oldValue === '__other__' ||
            (Array.isArray(oldValue) && oldValue.some(isOtherTokenEntry));

          if (hasOtherInputs || hasOtherMagic) {
            const migrated = migrateResponseValue(toLegacyResponseShape(questionId, oldShape), questionMapping);
            newQResponses[questionId] = migrated;
            changed = true;

            // mapping 누락 시 unhandled 카운트
            if (hasOtherMagic && !questionMapping['__other__']) {
              unhandledOther++;
            }
            continue;
          }

          // 케이스 2: 테이블 응답 — 셀 단위 __other__ 치환
          if (cellMapping && typeof oldShape === 'object' && oldShape !== null) {
            const { changed: cellChanged, value: newValue, cellsTouched, unhandled } =
              migrateTableResponse(oldShape, cellMapping);
            if (cellChanged) {
              newQResponses[questionId] = newValue;
              changed = true;
              tableCellsMigrated += cellsTouched;
              unhandledOther += unhandled;
              continue;
            }
          }

          newQResponses[questionId] = value;
        }

        if (changed) {
          if (!isDryRun) {
            await tx
              .update(schema.surveyResponses)
              .set({ questionResponses: newQResponses })
              .where(eq(schema.surveyResponses.id, resp.id));
          }
          responsesMigrated++;
        }
      }

      if (isDryRun) {
        console.log('--- DRY RUN: 트랜잭션 롤백 ---');
        throw new Error('DRY_RUN_ROLLBACK');
      }
    });
  } catch (err) {
    if ((err as Error).message === 'DRY_RUN_ROLLBACK') {
      // expected — dry-run 롤백
    } else {
      throw err;
    }
  } finally {
    await sqlClient.end();
  }

  console.log('완료:');
  console.log(`  questions: ${questionsMigrated}`);
  console.log(`  snapshots (survey_versions): ${snapshotsMigrated}`);
  console.log(`  responses: ${responsesMigrated}`);
  console.log(`  table cells (응답 내): ${tableCellsMigrated}`);
  console.log(`  unhandled __other__ (수동 확인 필요): ${unhandledOther}`);
  console.log(isDryRun ? '[DRY-RUN] DB 변경 없음. --apply 로 실제 적용.' : '[APPLIED]');
}

/**
 * 테이블 응답 안 __other__ 매직값을 cellMapping 으로 치환.
 * 테이블 응답의 shape:
 *   { value: { [rowId]: { [columnIdOrCellId]: cellValue } } }
 *   또는 { value: { [cellId]: cellValue } }
 *
 * cellValue 가 '__other__' 이거나 배열 안에 '__other__' 가 있으면 실제 옵션 ID 로 치환.
 * cellMapping: { cellId -> { '__other__' -> newOptionId } }
 */
function migrateTableResponse(
  resp: unknown,
  cellMap: Record<string, Record<string, string>>,
): { changed: boolean; value: unknown; cellsTouched: number; unhandled: number } {
  let changed = false;
  let cellsTouched = 0;
  let unhandled = 0;

  if (!isRecord(resp)) {
    return { changed: false, value: resp, cellsTouched: 0, unhandled: 0 };
  }

  function walk(node: unknown): unknown {
    if (node === '__other__') {
      // 단독 등장 — 상위 컨텍스트 없이 나온 경우 unhandled
      unhandled++;
      return node;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        // cellId 가 cellMap 에 있는 경우 — 그 값에 대해 매핑 적용
        const cellOtherId = cellMap[key]?.['__other__'];
        if (cellOtherId) {
          if (val === '__other__') {
            out[key] = cellOtherId;
            cellsTouched++;
            changed = true;
          } else if (Array.isArray(val) && val.includes('__other__')) {
            out[key] = val.map(v => (v === '__other__' ? cellOtherId : v));
            cellsTouched++;
            changed = true;
          } else {
            out[key] = walk(val);
          }
        } else {
          out[key] = walk(val);
        }
      }
      return out;
    }
    return node;
  }

  const newValue = walk(resp);
  return { changed, value: newValue, cellsTouched, unhandled };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
