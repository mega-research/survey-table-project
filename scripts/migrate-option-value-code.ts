/**
 * 옵션 value 를 사용자가 직접 입력한 optionCode(응답값)로 통일하는 일괄 마이그레이션 runner.
 *
 * 사용법:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/migrate-option-value-code.ts          # DRY RUN (기본)
 *   DRY_RUN=0 npx tsx --tsconfig tsconfig.scripts.json scripts/migrate-option-value-code.ts  # 실제 반영
 *
 * DRY RUN 에서도 트랜잭션 안에서 실제 UPDATE 를 수행한 뒤 rollback 한다 — jsonb 타입 검증과
 * orphan after 계산을 실제 저장 경로로 확인하기 위해서다.
 *
 * 변환 대상은 `isCustomOptionCode === true` 인 옵션뿐이다. 판별 근거와 함정은
 * `src/lib/option-value-code-migration.ts` 상단 주석 참조.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

import {
  applyQuestionOptionPlan,
  buildCellValueMaps,
  buildOrphanScope,
  buildQuestionValueMap,
  countOrphansByQuestion,
  mergeValueMaps,
  planQuestionOptions,
  remapConditionGroup,
  remapQuestionResponses,
  remapResponseValue,
  remapSnapshot,
  remapTableColumns,
  remapTableRows,
  summarizeQuestionPlan,
  type ConditionRemapMaps,
  type OptionValueChange,
  type OrphanScope,
  type QuestionOptionSource,
  type QuestionResponseSpec,
  type SkippedOptionCode,
  type ValueMap,
} from '../src/lib/option-value-code-migration';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('.env.local 을 찾을 수 없습니다. 환경변수를 직접 확인하세요.');
}

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL 이 설정되지 않았습니다.');
  process.exit(1);
}

const dryRunFlag = process.env['DRY_RUN'];
const DRY_RUN = dryRunFlag !== '0' && dryRunFlag !== 'false';
const ROLLBACK_SENTINEL = 'DRY_RUN_ROLLBACK';
/** 파이프라이닝 청크 — 트랜잭션 1개 안에서 왕복을 줄인다 */
const CHUNK = 25;

// ── DB 행 타입 ──

interface SurveyRow {
  id: string;
  title: string;
}

interface QuestionRow {
  id: string;
  survey_id: string;
  question_code: string | null;
  type: string;
  options: unknown;
  select_levels: unknown;
  ranking_config: unknown;
  table_rows_data: unknown;
  table_columns: unknown;
  display_condition: unknown;
}

interface GroupRow {
  id: string;
  survey_id: string;
  name: string;
  display_condition: unknown;
}

interface VersionRow {
  id: string;
  survey_id: string;
  version_number: number;
  snapshot: unknown;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  version_id: string | null;
  question_responses: unknown;
}

interface AnswerRow {
  id: string;
  question_id: string;
  text_value: string | null;
  array_value: unknown;
  object_value: unknown;
}

function toSource(row: QuestionRow): QuestionOptionSource {
  return {
    id: row.id,
    options: row.options,
    selectLevels: row.select_levels,
    rankingConfig: row.ranking_config,
    tableRowsData: row.table_rows_data,
  };
}

function sum(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

async function inChunks<T>(items: T[], run: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.all(items.slice(i, i + CHUNK).map(run));
  }
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { prepare: false });

  console.log(DRY_RUN ? '[DRY-RUN]' : '[APPLY]', '옵션 value ← 커스텀 optionCode 마이그레이션 시작');
  console.log('');

  let failed = false;

  try {
    await sql.begin(async (tx) => {
      // ── 로드 ──
      const surveys = await tx<SurveyRow[]>`
        select id, title from surveys where deleted_at is null order by created_at
      `;
      const surveyIds = surveys.map((s) => s.id);
      const surveyTitle = new Map(surveys.map((s) => [s.id, s.title]));

      const questions = await tx<QuestionRow[]>`
        select id, survey_id, question_code, type, options, select_levels, ranking_config,
               table_rows_data, table_columns, display_condition
        from questions where survey_id in ${tx(surveyIds)}
      `;
      const groups = await tx<GroupRow[]>`
        select id, survey_id, name, display_condition
        from question_groups where survey_id in ${tx(surveyIds)}
      `;
      const versions = await tx<VersionRow[]>`
        select id, survey_id, version_number, snapshot
        from survey_versions where survey_id in ${tx(surveyIds)} and deleted_at is null
      `;
      const responses = await tx<ResponseRow[]>`
        select id, survey_id, version_id, question_responses
        from survey_responses where survey_id in ${tx(surveyIds)} and deleted_at is null
      `;

      console.log(
        `로드: surveys=${surveys.length} questions=${questions.length} groups=${groups.length} ` +
          `versions=${versions.length} responses=${responses.length}`,
      );
      console.log('');

      // ── 1. 변환 계획 ──
      const plans = new Map<string, ReturnType<typeof planQuestionOptions>>();
      const questionById = new Map(questions.map((q) => [q.id, q]));
      const byQuestion = new Map<string, ValueMap>();
      const byQuestionCells = new Map<string, ValueMap>();
      const cellMapsByQuestion = new Map<string, Map<string, Map<string, string>>>();
      const cellMapsGlobal = new Map<string, Map<string, string>>();
      const optionChangesBySnapshotQuestion = new Map<string, Map<string, OptionValueChange>>();
      const optionChangesBySnapshotCell = new Map<string, Map<string, OptionValueChange>>();

      const perQuestionReport: Array<{
        surveyId: string;
        questionCode: string;
        questionId: string;
        type: string;
        changes: OptionValueChange[];
        skipped: SkippedOptionCode[];
      }> = [];
      let excludedNonCustomTotal = 0;
      const allSkipped: Array<SkippedOptionCode & { questionCode: string; questionId: string }> = [];

      for (const question of questions) {
        const plan = planQuestionOptions(toSource(question));
        const summary = summarizeQuestionPlan(plan);
        excludedNonCustomTotal += summary.excludedNonCustom;
        plans.set(question.id, plan);

        if (summary.skipped.length > 0) {
          for (const skip of summary.skipped) {
            allSkipped.push({ ...skip, questionCode: question.question_code ?? '(코드없음)', questionId: question.id });
          }
        }
        if (summary.changes.length === 0 && summary.skipped.length === 0) continue;

        perQuestionReport.push({
          surveyId: question.survey_id,
          questionCode: question.question_code ?? '(코드없음)',
          questionId: question.id,
          type: question.type,
          changes: summary.changes,
          skipped: summary.skipped,
        });

        const questionMap = buildQuestionValueMap(plan);
        if (questionMap.size > 0) {
          byQuestion.set(question.id, questionMap);
          const byOptionId = new Map<string, OptionValueChange>();
          for (const change of [
            ...plan.questionLevel.changes,
            ...plan.rankingConfig.changes,
            ...plan.selectLevels.flatMap((entry) => entry.plan.changes),
          ]) {
            if (change.optionId !== null) byOptionId.set(change.optionId, change);
          }
          if (byOptionId.size > 0) optionChangesBySnapshotQuestion.set(question.id, byOptionId);
        }

        const cellMaps = buildCellValueMaps(plan);
        if (cellMaps.size > 0) {
          cellMapsByQuestion.set(question.id, cellMaps);
          byQuestionCells.set(question.id, mergeValueMaps(cellMaps.values()).map);
          for (const [cellId, map] of cellMaps) cellMapsGlobal.set(cellId, map);
          for (const entry of plan.cells) {
            if (entry.plan.changes.length === 0) continue;
            const byOptionId = optionChangesBySnapshotCell.get(entry.cellId) ?? new Map<string, OptionValueChange>();
            for (const change of entry.plan.changes) {
              if (change.optionId !== null) byOptionId.set(change.optionId, change);
            }
            optionChangesBySnapshotCell.set(entry.cellId, byOptionId);
          }
        }
      }

      const conditionMaps: ConditionRemapMaps = { byQuestion, byQuestionCells };

      // ── 리포트: 변경 후보 ──
      console.log('=== 1. value 변경 후보 ===');
      const bySurvey = new Map<string, typeof perQuestionReport>();
      for (const entry of perQuestionReport) {
        const list = bySurvey.get(entry.surveyId) ?? [];
        list.push(entry);
        bySurvey.set(entry.surveyId, list);
      }
      let changeTotal = 0;
      for (const [surveyId, entries] of bySurvey) {
        const count = entries.reduce((sum, e) => sum + e.changes.length, 0);
        changeTotal += count;
        console.log(`  [${surveyTitle.get(surveyId) ?? surveyId}] 질문 ${entries.length}개 / 옵션 ${count}건`);
        for (const entry of entries) {
          const detail = entry.changes.map((c) => `${c.oldValue}->${c.newValue}`).join(', ');
          console.log(`    - ${entry.questionCode} (${entry.type}) ${entry.changes.length}건: ${detail || '(없음)'}`);
        }
      }
      if (perQuestionReport.length === 0) console.log('  (없음)');
      console.log(`  합계: 옵션 value 변경 후보 ${changeTotal}건`);
      console.log(
        `  제외(optionCode 는 있으나 isCustomOptionCode !== true — 자동 발번 추정): ${excludedNonCustomTotal}건`,
      );
      console.log('');

      console.log('=== 2. 충돌로 스킵된 옵션 ===');
      if (allSkipped.length === 0) console.log('  (없음)');
      for (const skip of allSkipped) {
        console.log(
          `  - ${skip.questionCode} optionId=${skip.optionId} value=${skip.value} code=${skip.optionCode} (${skip.reason})`,
        );
      }
      console.log('');

      // ── 2. orphan BEFORE ──
      const scopesBefore = new Map<string, OrphanScope>();
      for (const question of questions) scopesBefore.set(question.id, buildOrphanScope(toSource(question)));

      const snapshotScopesBefore = buildSnapshotScopes(versions);

      const orphanLiveBefore = new Map<string, number>();
      const orphanSnapshotBefore = new Map<string, number>();
      for (const response of responses) {
        countOrphansByQuestion(response.question_responses, scopesBefore, orphanLiveBefore);
        const scope = response.version_id ? snapshotScopesBefore.get(response.version_id) : undefined;
        if (scope) countOrphansByQuestion(response.question_responses, scope, orphanSnapshotBefore);
      }

      // ── 3. 쓰기: questions ──
      const writtenQuestionIds: string[] = [];
      let questionConditionCount = 0;
      let questionGatingCount = 0;

      const questionWrites: Array<{ row: QuestionRow; patch: Record<string, unknown> }> = [];
      for (const question of questions) {
        const plan = plans.get(question.id);
        if (!plan) continue;
        const source = toSource(question);
        const applied = applyQuestionOptionPlan(source, plan);

        const patch: Record<string, unknown> = {};
        if (applied.options !== source.options) patch['options'] = applied.options;
        if (applied.selectLevels !== source.selectLevels) patch['select_levels'] = applied.selectLevels;
        if (applied.rankingConfig !== source.rankingConfig) patch['ranking_config'] = applied.rankingConfig;

        let tableRowsData = applied.tableRowsData;
        const ownCellMaps = cellMapsByQuestion.get(question.id) ?? new Map<string, Map<string, string>>();
        const rowsRemap = remapTableRows(tableRowsData, conditionMaps, ownCellMaps);
        if (rowsRemap.conditionCount + rowsRemap.gatingCount > 0) {
          tableRowsData = rowsRemap.value;
          questionConditionCount += rowsRemap.conditionCount;
          questionGatingCount += rowsRemap.gatingCount;
        }
        if (tableRowsData !== source.tableRowsData) patch['table_rows_data'] = tableRowsData;

        const columnsRemap = remapTableColumns(question.table_columns, conditionMaps);
        if (columnsRemap.count > 0) {
          patch['table_columns'] = columnsRemap.value;
          questionConditionCount += columnsRemap.count;
        }

        const conditionRemap = remapConditionGroup(question.display_condition, conditionMaps);
        if (conditionRemap.count > 0) {
          patch['display_condition'] = conditionRemap.value;
          questionConditionCount += conditionRemap.count;
        }

        if (Object.keys(patch).length === 0) continue;
        questionWrites.push({ row: question, patch });
        writtenQuestionIds.push(question.id);
      }

      await inChunks(questionWrites, async ({ row, patch }) => {
        for (const [column, value] of Object.entries(patch)) {
          await updateJsonbColumn(tx, 'questions', column, row.id, value);
        }
      });

      // ── 4. 쓰기: question_groups ──
      const groupWrites: Array<{ id: string; value: unknown }> = [];
      let groupConditionCount = 0;
      for (const group of groups) {
        const remapped = remapConditionGroup(group.display_condition, conditionMaps);
        if (remapped.count === 0) continue;
        groupConditionCount += remapped.count;
        groupWrites.push({ id: group.id, value: remapped.value });
      }
      await inChunks(groupWrites, ({ id, value }) =>
        updateJsonbColumn(tx, 'question_groups', 'display_condition', id, value),
      );

      // ── 5. 쓰기: survey_versions.snapshot ──
      const versionWrites: Array<{ id: string; snapshot: unknown }> = [];
      let snapshotOptionCount = 0;
      let snapshotOptionByValueCount = 0;
      let snapshotOptionConflictCount = 0;
      let snapshotConditionCount = 0;
      let snapshotGatingCount = 0;
      const migratedSnapshots = new Map<string, unknown>();

      for (const version of versions) {
        const result = remapSnapshot(
          version.snapshot,
          optionChangesBySnapshotQuestion,
          optionChangesBySnapshotCell,
          conditionMaps,
          cellMapsGlobal,
        );
        migratedSnapshots.set(version.id, result.snapshot);
        snapshotOptionConflictCount += result.optionConflictCount;
        if (!result.changed) continue;
        snapshotOptionCount += result.optionCount;
        snapshotOptionByValueCount += result.optionByValueCount;
        snapshotConditionCount += result.conditionCount;
        snapshotGatingCount += result.gatingCount;
        versionWrites.push({ id: version.id, snapshot: result.snapshot });
      }
      await inChunks(versionWrites, ({ id, snapshot }) =>
        updateJsonbColumn(tx, 'survey_versions', 'snapshot', id, snapshot),
      );

      // ── 6. 쓰기: survey_responses.question_responses ──
      const responseSpecs = new Map<string, QuestionResponseSpec>();
      for (const question of questions) {
        const questionMap = byQuestion.get(question.id) ?? null;
        const cellMaps = cellMapsByQuestion.get(question.id) ?? null;
        if (!questionMap && !cellMaps) continue;
        responseSpecs.set(question.id, { questionMap, cellMaps });
      }

      const responseWrites: Array<{ id: string; value: unknown }> = [];
      const migratedResponses = new Map<string, unknown>();
      let responseValueCount = 0;
      for (const response of responses) {
        const remapped = remapQuestionResponses(response.question_responses, responseSpecs);
        migratedResponses.set(response.id, remapped.value);
        if (remapped.count === 0) continue;
        responseValueCount += remapped.count;
        responseWrites.push({ id: response.id, value: remapped.value });
      }
      await inChunks(responseWrites, ({ id, value }) =>
        updateJsonbColumn(tx, 'survey_responses', 'question_responses', id, value),
      );

      // ── 7. 쓰기: response_answers ──
      const targetQuestionIds = [...responseSpecs.keys()];
      let answerRows: AnswerRow[] = [];
      if (targetQuestionIds.length > 0) {
        answerRows = await tx<AnswerRow[]>`
          select a.id, a.question_id, a.text_value, a.array_value, a.object_value
          from response_answers a
          join survey_responses r on r.id = a.response_id
          where r.deleted_at is null and a.question_id in ${tx(targetQuestionIds)}
        `;
      }

      const answerWrites: Array<{ id: string; column: string; value: unknown }> = [];
      let answerValueCount = 0;
      for (const answer of answerRows) {
        const spec = responseSpecs.get(answer.question_id);
        if (!spec) continue;

        const text = remapResponseValue(answer.text_value, spec);
        if (text.count > 0) {
          answerWrites.push({ id: answer.id, column: 'text_value', value: text.value });
          answerValueCount += text.count;
        }
        const array = remapResponseValue(answer.array_value, spec);
        if (array.count > 0) {
          answerWrites.push({ id: answer.id, column: 'array_value', value: array.value });
          answerValueCount += array.count;
        }
        const object = remapResponseValue(answer.object_value, spec);
        if (object.count > 0) {
          answerWrites.push({ id: answer.id, column: 'object_value', value: object.value });
          answerValueCount += object.count;
        }
      }
      await inChunks(answerWrites, ({ id, column, value }) => {
        if (column === 'text_value') {
          return tx`update response_answers set text_value = ${value as string} where id = ${id}`;
        }
        return updateJsonbColumn(tx, 'response_answers', column, id, value);
      });

      console.log('=== 3. 리매핑 대상 ===');
      console.log(`  questions 쓰기 대상: ${writtenQuestionIds.length}행`);
      console.log(`  표시조건 값 치환 (questions/행/열): ${questionConditionCount}건`);
      console.log(`  셀 게이팅 값 치환: ${questionGatingCount}건`);
      console.log(`  question_groups 표시조건 치환: ${groupConditionCount}건 (${groupWrites.length}행)`);
      console.log(
        `  survey_versions 스냅샷: ${versionWrites.length}행 ` +
          `(옵션 ${snapshotOptionCount} — 그중 value 폴백 매칭 ${snapshotOptionByValueCount} / ` +
          `조건 ${snapshotConditionCount} / 게이팅 ${snapshotGatingCount} / 폴백 충돌 ${snapshotOptionConflictCount})`,
      );
      console.log(`  survey_responses: ${responseWrites.length}행 / 응답값 ${responseValueCount}건`);
      console.log(
        `  response_answers: ${answerWrites.length}컬럼 쓰기 / 값 ${answerValueCount}건 (스캔 ${answerRows.length}행)`,
      );
      console.log('');

      // ── 8. jsonb 타입 검증 (이중 인코딩 사고 방지) ──
      console.log('=== 4. jsonb 타입 검증 ===');
      const typeProblems: string[] = [];
      if (writtenQuestionIds.length > 0) {
        const bad = await tx<{ id: string; col: string; t: string | null }[]>`
          select id, 'options' as col, jsonb_typeof(options) as t from questions
            where id in ${tx(writtenQuestionIds)} and options is not null and jsonb_typeof(options) <> 'array'
          union all
          select id, 'select_levels', jsonb_typeof(select_levels) from questions
            where id in ${tx(writtenQuestionIds)} and select_levels is not null and jsonb_typeof(select_levels) <> 'array'
          union all
          select id, 'table_rows_data', jsonb_typeof(table_rows_data) from questions
            where id in ${tx(writtenQuestionIds)} and table_rows_data is not null and jsonb_typeof(table_rows_data) <> 'array'
          union all
          select id, 'table_columns', jsonb_typeof(table_columns) from questions
            where id in ${tx(writtenQuestionIds)} and table_columns is not null and jsonb_typeof(table_columns) <> 'array'
          union all
          select id, 'display_condition', jsonb_typeof(display_condition) from questions
            where id in ${tx(writtenQuestionIds)} and display_condition is not null and jsonb_typeof(display_condition) <> 'object'
          union all
          select id, 'ranking_config', jsonb_typeof(ranking_config) from questions
            where id in ${tx(writtenQuestionIds)} and ranking_config is not null and jsonb_typeof(ranking_config) <> 'object'
        `;
        for (const row of bad) typeProblems.push(`questions.${row.col} id=${row.id} typeof=${row.t}`);
      }
      if (versionWrites.length > 0) {
        const bad = await tx<{ id: string; t: string | null }[]>`
          select id, jsonb_typeof(snapshot) as t from survey_versions
          where id in ${tx(versionWrites.map((w) => w.id))} and jsonb_typeof(snapshot) <> 'object'
        `;
        for (const row of bad) typeProblems.push(`survey_versions.snapshot id=${row.id} typeof=${row.t}`);
      }
      if (responseWrites.length > 0) {
        const bad = await tx<{ id: string; t: string | null }[]>`
          select id, jsonb_typeof(question_responses) as t from survey_responses
          where id in ${tx(responseWrites.map((w) => w.id))} and jsonb_typeof(question_responses) <> 'object'
        `;
        for (const row of bad) typeProblems.push(`survey_responses.question_responses id=${row.id} typeof=${row.t}`);
      }
      const answerIds = [...new Set(answerWrites.map((w) => w.id))];
      if (answerIds.length > 0) {
        const bad = await tx<{ id: string; col: string; t: string | null }[]>`
          select id, 'array_value' as col, jsonb_typeof(array_value) as t from response_answers
            where id in ${tx(answerIds)} and array_value is not null and jsonb_typeof(array_value) <> 'array'
          union all
          select id, 'object_value', jsonb_typeof(object_value) from response_answers
            where id in ${tx(answerIds)} and object_value is not null and jsonb_typeof(object_value) <> 'object'
        `;
        for (const row of bad) typeProblems.push(`response_answers.${row.col} id=${row.id} typeof=${row.t}`);
      }
      if (typeProblems.length === 0) {
        console.log('  통과 — 쓰기 대상 전 컬럼이 기대 jsonb 타입 유지');
      } else {
        failed = true;
        for (const problem of typeProblems) console.log(`  실패: ${problem}`);
      }
      console.log('');

      // ── 9. orphan AFTER — DB 재조회 기준 ──
      const questionsAfter = await tx<QuestionRow[]>`
        select id, survey_id, question_code, type, options, select_levels, ranking_config,
               table_rows_data, table_columns, display_condition
        from questions where survey_id in ${tx(surveyIds)}
      `;
      const responsesAfter = await tx<ResponseRow[]>`
        select id, survey_id, version_id, question_responses
        from survey_responses where survey_id in ${tx(surveyIds)} and deleted_at is null
      `;

      const scopesAfter = new Map<string, OrphanScope>();
      for (const question of questionsAfter) scopesAfter.set(question.id, buildOrphanScope(toSource(question)));
      const snapshotScopesAfter = buildSnapshotScopes(
        versions.map((v) => ({ ...v, snapshot: migratedSnapshots.get(v.id) ?? v.snapshot })),
      );

      const orphanLiveAfter = new Map<string, number>();
      const orphanSnapshotAfter = new Map<string, number>();
      for (const response of responsesAfter) {
        countOrphansByQuestion(response.question_responses, scopesAfter, orphanLiveAfter);
        const scope = response.version_id ? snapshotScopesAfter.get(response.version_id) : undefined;
        if (scope) countOrphansByQuestion(response.question_responses, scope, orphanSnapshotAfter);
      }

      const questionLabel = (questionId: string): string => {
        const question = questionById.get(questionId);
        return question ? `${question.question_code ?? '(코드없음)'}/${questionId}` : questionId;
      };
      const reportOrphan = (label: string, before: Map<string, number>, after: Map<string, number>): boolean => {
        const beforeTotal = sum(before);
        const afterTotal = sum(after);
        console.log(`  ${label}: before=${beforeTotal} after=${afterTotal}`);
        const deltas: Array<[string, number]> = [];
        for (const questionId of new Set([...before.keys(), ...after.keys()])) {
          const delta = (after.get(questionId) ?? 0) - (before.get(questionId) ?? 0);
          if (delta > 0) deltas.push([questionId, delta]);
        }
        deltas.sort((a, b) => b[1] - a[1]);
        for (const [questionId, delta] of deltas) console.log(`    증가: ${questionLabel(questionId)} +${delta}`);
        return afterTotal > beforeTotal;
      };

      console.log('=== 5. orphan 응답값 검증 ===');
      const liveIncreased = reportOrphan('현행 질문 정의 기준', orphanLiveBefore, orphanLiveAfter);
      const snapshotIncreased = reportOrphan('응답 버전 스냅샷 기준', orphanSnapshotBefore, orphanSnapshotAfter);
      if (liveIncreased || snapshotIncreased) {
        failed = true;
        console.log('  실패: orphan 이 증가했습니다 — 리매핑 누락이 있습니다.');
      } else {
        console.log('  통과 — orphan 증가 없음');
      }
      console.log('');

      if (failed) throw new Error('MIGRATION_VERIFICATION_FAILED');
      if (DRY_RUN) {
        console.log('--- DRY RUN: 트랜잭션 롤백 ---');
        throw new Error(ROLLBACK_SENTINEL);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === ROLLBACK_SENTINEL) {
      // 정상 dry-run 롤백
    } else if (message === 'MIGRATION_VERIFICATION_FAILED') {
      console.error('검증 실패로 롤백했습니다.');
      await sql.end();
      process.exit(1);
    } else {
      await sql.end();
      throw error;
    }
  }

  await sql.end();
  console.log(DRY_RUN ? '[DRY-RUN] DB 변경 없음. DRY_RUN=0 으로 실제 적용.' : '[APPLIED] 마이그레이션 완료.');
}

/**
 * jsonb 컬럼 갱신. `JSON.stringify()` + `::jsonb` 캐스트는 jsonb string 으로 이중 인코딩되므로
 * 반드시 sql.json 파라미터로 넘긴다.
 */
function updateJsonbColumn(
  tx: postgres.TransactionSql,
  table: 'questions' | 'question_groups' | 'survey_versions' | 'survey_responses' | 'response_answers',
  column: string,
  id: string,
  value: unknown,
): Promise<unknown> {
  return tx`update ${tx(table)} set ${tx(column)} = ${tx.json(value as never)} where id = ${id}`;
}

/** versionId → (questionId → orphan 판정 스코프) */
function buildSnapshotScopes(versions: Array<{ id: string; snapshot: unknown }>): Map<string, Map<string, OrphanScope>> {
  const result = new Map<string, Map<string, OrphanScope>>();

  for (const version of versions) {
    const snapshot = version.snapshot;
    if (typeof snapshot !== 'object' || snapshot === null) continue;
    const snapshotQuestions = (snapshot as { questions?: unknown }).questions;
    if (!Array.isArray(snapshotQuestions)) continue;

    const scopes = new Map<string, OrphanScope>();
    for (const question of snapshotQuestions) {
      if (typeof question !== 'object' || question === null) continue;
      const record = question as Record<string, unknown>;
      const id = typeof record['id'] === 'string' ? record['id'] : null;
      if (id === null) continue;
      scopes.set(
        id,
        buildOrphanScope({
          id,
          options: record['options'],
          selectLevels: record['selectLevels'],
          rankingConfig: record['rankingConfig'],
          tableRowsData: record['tableRowsData'],
        }),
      );
    }
    result.set(version.id, scopes);
  }

  return result;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
