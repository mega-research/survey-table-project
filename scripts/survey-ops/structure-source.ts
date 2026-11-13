/**
 * 설문 구조를 불러오는 두 길 — 조립 산출물 파일과 DB 저장본. `survey:check` · `survey:summary` 가 같이 쓴다.
 *
 * DB 는 SELECT 만 한다(`variables.ts` 의 `loadStructureRows`). `@/db` 는 env 를 읽은 뒤에 동적 import 한다.
 */
import { readFileSync } from 'node:fs';

import type { CheckSource, RawQuestion } from './check-core';
import { loadOpsEnv } from './env';

export interface LoadedStructure {
  /** 출력 머리에 적을 이름 — 어디서 읽었는지와 설문 제목 */
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
    throw new Error(
      `${file} 에 questions 배열이 없습니다 — { survey, groups, questions } 모양이어야 합니다`,
    );
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

export function loadStructure(source: CheckSource): Promise<LoadedStructure> {
  return source.kind === 'file'
    ? Promise.resolve(loadFile(source.path))
    : loadDb(source.surveyId, source.env);
}
