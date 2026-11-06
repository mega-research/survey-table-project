/**
 * 운영 설문 고치기 도우미의 핵심 — 접속(db)을 받아 한 트랜잭션으로 돌린다. CLI 는 `patch.ts`.
 * 이 파일은 `@/db` 접속을 만드는 모듈을 끌어오므로 env 를 채운 뒤에만 import 한다(patch.ts 가 동적 import).
 *
 * 패치 스크립트는 바꿀 내용(`apply`)만 쓴다.
 *
 *   import { runSurveyPatch } from '../../scripts/survey-ops/patch';   // .scratch/<작업>/ 에서
 *   runSurveyPatch({
 *     surveyId: '…',
 *     title: '문2 설명 둘째 줄',
 *     apply: async ({ tx, schema, eq, and }) => { … tx.update(schema.questions)… },
 *   });
 *
 * 실행: pnpm exec tsx --tsconfig tsconfig.scripts.json <파일> --env prod [--commit] [--allow-var-changes]
 *
 * 한 트랜잭션 안에서: 설문 행 FOR UPDATE → 고치기 전 변수명 → apply → 고친 뒤 변수명 → 비교.
 * - 기본은 시험 실행이라 끝에서 되돌린다. `--commit` 일 때만 커밋한다.
 * - 없어지는 변수명이 하나라도 있으면 `--allow-var-changes` 없이는 되돌린다(새로 생기는 이름은 보여 주기만).
 * - 바뀐 행이 있으면 `surveys.updated_at` 을 올린다.
 * - 빌더 저장은 이 잠금을 잡지 않는다 — 빌더 탭이 열려 있으면 그 탭의 저장이 이 수정을 덮을 수 있다.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { db as AppDb, DbTransaction } from '@/db';
import * as schema from '@/db/schema';

import {
  type SurveyStructureRows,
  type VariableDiff,
  diffVariables,
  formatVariableDiff,
  loadStructureRows,
  structureVariables,
} from './variables';

export interface PatchContext {
  tx: DbTransaction;
  surveyId: string;
  schema: typeof schema;
  eq: typeof eq;
  and: typeof and;
  inArray: typeof inArray;
  asc: typeof asc;
  sql: typeof sql;
  /** 고치기 전 구조(문항·그룹 행) — 원문 대조에 쓴다 */
  before: SurveyStructureRows;
  log: (message: string) => void;
}

export interface SurveyPatch {
  surveyId: string;
  /** 무엇을 고치는지 한 줄 — 출력 머리에 찍힌다 */
  title: string;
  apply: (ctx: PatchContext) => Promise<void>;
}

export interface PatchOptions {
  commit: boolean;
  allowVarChanges: boolean;
  log?: (message: string) => void;
}

export type PatchOutcome = 'committed' | 'dry-run' | 'rejected-var-change' | 'no-change';

export interface PatchResult {
  outcome: PatchOutcome;
  diff: VariableDiff;
  changedQuestionCodes: string[];
  changedGroupCount: number;
}

class Rollback extends Error {
  constructor(readonly result: PatchResult) {
    super(result.outcome);
  }
}

/** 문항·그룹 행을 비교할 지문 — updated_at 은 빼고 본다(값이 같아도 시각만 바뀐 쓰기는 변경이 아니다). */
function rowFingerprint(row: Record<string, unknown>): string {
  const { updatedAt: _u, createdAt: _c, ...rest } = row;
  return JSON.stringify(rest);
}

function changedRows(before: SurveyStructureRows, after: SurveyStructureRows) {
  const prevQ = new Map(before.questionRows.map((r) => [r.id, rowFingerprint(r)]));
  const nextQ = new Map(after.questionRows.map((r) => [r.id, rowFingerprint(r)]));
  const codes = (id: string) =>
    after.questionRows.find((r) => r.id === id)?.questionCode ??
    before.questionRows.find((r) => r.id === id)?.questionCode ??
    id.slice(0, 8);
  const qIds = new Set([...prevQ.keys(), ...nextQ.keys()]);
  const changedQuestionCodes = [...qIds].filter((id) => prevQ.get(id) !== nextQ.get(id)).map(codes);
  const prevG = new Map(before.groupRows.map((r) => [r.id, rowFingerprint(r)]));
  const nextG = new Map(after.groupRows.map((r) => [r.id, rowFingerprint(r)]));
  const gIds = new Set([...prevG.keys(), ...nextG.keys()]);
  const changedGroupCount = [...gIds].filter((id) => prevG.get(id) !== nextG.get(id)).length;
  return { changedQuestionCodes, changedGroupCount };
}

/** 실DB 테스트가 직접 부른다. */
export async function executeSurveyPatch(
  database: typeof AppDb,
  patch: SurveyPatch,
  options: PatchOptions,
): Promise<PatchResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  try {
    return await database.transaction(async (tx) => {
      // 풀러(6543)에 세션 SET 을 남기지 않도록 트랜잭션 범위(LOCAL)로만 건다.
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [survey] = await tx
        .select({ id: schema.surveys.id, title: schema.surveys.title })
        .from(schema.surveys)
        .where(eq(schema.surveys.id, patch.surveyId))
        .for('update');
      if (!survey) throw new Error(`설문이 없습니다: ${patch.surveyId}`);
      log(`설문: ${survey.title}\n작업: ${patch.title}`);

      const before = await loadStructureRows(tx, patch.surveyId);
      const beforeVars = structureVariables(patch.surveyId, before);

      await patch.apply({
        tx,
        surveyId: patch.surveyId,
        schema,
        eq,
        and,
        inArray,
        asc,
        sql,
        before,
        log,
      });

      const after = await loadStructureRows(tx, patch.surveyId);
      const diff = diffVariables(beforeVars, structureVariables(patch.surveyId, after));
      const { changedQuestionCodes, changedGroupCount } = changedRows(before, after);
      const base = { diff, changedQuestionCodes, changedGroupCount };

      log(
        changedQuestionCodes.length + changedGroupCount === 0
          ? '바뀐 문항·그룹 없음'
          : `바뀐 문항 ${changedQuestionCodes.length}개${changedQuestionCodes.length ? ` (${changedQuestionCodes.join(', ')})` : ''}` +
              (changedGroupCount ? ` · 바뀐 그룹 ${changedGroupCount}개` : ''),
      );
      log(formatVariableDiff(diff));

      if (changedQuestionCodes.length + changedGroupCount === 0) {
        throw new Rollback({ outcome: 'no-change', ...base });
      }
      if (diff.removed.length > 0 && !options.allowVarChanges) {
        log(
          '없어지는 변수명이 있어 되돌립니다. 의도한 것이면 --allow-var-changes 를 붙여 다시 실행하세요.',
        );
        throw new Rollback({ outcome: 'rejected-var-change', ...base });
      }
      await tx
        .update(schema.surveys)
        .set({ updatedAt: new Date() })
        .where(eq(schema.surveys.id, patch.surveyId));
      if (!options.commit) {
        log('시험 실행 — 되돌렸습니다. 반영하려면 --commit 을 붙이세요.');
        throw new Rollback({ outcome: 'dry-run', ...base });
      }
      return { outcome: 'committed' as const, ...base };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.result;
    throw err;
  }
}
