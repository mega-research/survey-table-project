/**
 * 설문 구조 점검 — 오류(내보내기·응답이 깨진다)와 알림(조립 규칙과 다르다).
 *
 *   pnpm survey:check <surveyId> --env prod|local      DB 의 저장본 (읽기만)
 *   pnpm survey:check --file .scratch/<설문>/out.json   넣기 전 조립 산출물 { survey, groups, questions }
 *           [--tsv <경로>]                             변수명·엑셀라벨·타입·측정수준·형식·값 라벨 표
 *
 * 오류가 하나라도 있으면 종료 코드 1 이다 — 조립 스크립트는 넣기 전에 이것을 건다.
 * 점검 목록과 판정은 `check-core.ts`, 규칙의 출처는 `docs/agents/survey-variable-rules.md` ·
 * `docs/agents/survey-screen-rules.md`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import {
  checkSurveyStructure,
  formatCheckReport,
  parseCheckArgs,
  type CheckReport,
  type RawQuestion,
} from './check-core';
import { exitWithError, loadOpsEnv } from './env';

interface LoadedStructure {
  title: string;
  questions: RawQuestion[];
  groups: unknown[];
}

function loadFile(file: string): LoadedStructure {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    survey?: { title?: string };
    groups?: unknown[];
    questions?: RawQuestion[];
  };
  if (!Array.isArray(parsed.questions))
    throw new Error(`${file} 에 questions 배열이 없습니다 — { survey, groups, questions } 모양이어야 합니다`);
  return {
    title: `${file} · ${parsed.survey?.title ?? '(제목 없음)'}`,
    questions: parsed.questions,
    groups: parsed.groups ?? [],
  };
}

async function loadDb(surveyId: string, env: 'prod' | 'local'): Promise<LoadedStructure> {
  const { host, file: envSource } = loadOpsEnv(env);
  const { db } = await import('@/db');
  const { loadStructureRows, surveyTitle } = await import('./variables');
  const title = await surveyTitle(db, surveyId);
  if (title === null) throw new Error(`설문이 없습니다: ${surveyId}`);
  const rows = await loadStructureRows(db, surveyId);
  return {
    title: `${env} (${host} · ${envSource}) · ${title}`,
    questions: rows.questionRows as unknown as RawQuestion[],
    groups: rows.groupRows,
  };
}

async function writeVariableTable(file: string, report: CheckReport): Promise<void> {
  const { columnCellLabel } = await import('@/lib/analytics/column-cell-label');
  const { buildCodebookValueLabel } = await import('@/lib/analytics/raw-export-helpers');
  const { buildCodebookVariableMetadata } = await import('@/lib/spss/export-metadata');
  const byId = new Map(report.hydrated.map((q) => [q.id, q]));
  const lines = report.columns.map((c) => {
    const meta = buildCodebookVariableMetadata(c, byId.get(c.questionId));
    return [
      c.spssVarName,
      columnCellLabel(c),
      meta.variableType,
      meta.measure,
      meta.displayFormat,
      buildCodebookValueLabel(c, byId),
    ].join('\t');
  });
  writeFileSync(file, ['변수명\t엑셀라벨\t타입\t측정수준\t형식\t값 라벨', ...lines].join('\n'));
}

void (async () => {
  try {
    const source = parseCheckArgs(process.argv.slice(2));
    const loaded =
      source.kind === 'file' ? loadFile(source.path) : await loadDb(source.surveyId, source.env);
    const report = checkSurveyStructure({ questions: loaded.questions, groups: loaded.groups });
    console.log(formatCheckReport(loaded.title, report));
    if (source.tsv) {
      await writeVariableTable(source.tsv, report);
      console.log(`변수 표: ${source.tsv}`);
    }
    process.exit(report.findings.some((f) => f.level === 'error') ? 1 : 0);
  } catch (err) {
    exitWithError(err);
  }
})();
