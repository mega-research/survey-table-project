/**
 * 운영 설문 도구(scripts/survey-ops) — 인자·접속 대상 판정과, 변수명 계산이 내보내기와 같은 사슬인지.
 *
 * scripts/ 는 tsc 대상이 아니라서 앱 함수 이름이 바뀌면 조용히 썩는다. 이 테스트가 그 모듈을 import 해
 * 깨진 import 를 먼저 드러낸다. 실DB 패치 왕복은 tests/integration/survey-ops-patch.realdb.test.ts.
 */
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { questionGroups, questions } from '@/db/schema';

import { pruneOldDumps } from '../../scripts/survey-ops/dump';
import {
  assertTargetHost,
  parseEnvFile,
  parseOpsArgs,
  resolveOpsEnv,
} from '../../scripts/survey-ops/env';
import { diffVariables, structureVariables } from '../../scripts/survey-ops/variables';

describe('parseOpsArgs', () => {
  it('--env 가 없으면 거부한다 — 어느 DB 에 붙을지 기본값을 두지 않는다', () => {
    expect(() => parseOpsArgs(['abc'])).toThrow(/--env/);
    expect(() => parseOpsArgs(['abc', '--env', 'staging'])).toThrow(/--env/);
  });

  it('기본은 시험 실행이고 --commit · --allow-var-changes 는 명시할 때만 켜진다', () => {
    expect(parseOpsArgs(['--env', 'prod'])).toMatchObject({
      env: 'prod',
      commit: false,
      allowVarChanges: false,
    });
    const a = parseOpsArgs([
      's1',
      '--env=local',
      '--commit',
      '--allow-var-changes',
      '--resid',
      '7',
    ]);
    expect(a).toMatchObject({
      env: 'local',
      commit: true,
      allowVarChanges: true,
      positionals: ['s1'],
    });
    expect(a.flags.get('resid')).toBe('7');
  });

  it('값이 필요한 플래그에 값이 없으면 거부한다', () => {
    expect(() => parseOpsArgs(['--env', 'prod', '--resid'])).toThrow(/--resid/);
  });
});

describe('접속 대상', () => {
  it('env 파일의 따옴표와 주석을 벗긴다', () => {
    expect(parseEnvFile('# DATABASE_URL=nope\nDATABASE_URL="postgres://u:p@h:1/d"\nA=b\n')).toEqual(
      {
        DATABASE_URL: 'postgres://u:p@h:1/d',
        A: 'b',
      },
    );
  });

  it('prod 인데 로컬 host 면, local 인데 운영 host 면 거부한다', () => {
    expect(() =>
      assertTargetHost('prod', 'postgresql://postgres:x@127.0.0.1:5432/postgres'),
    ).toThrow(/prod/);
    expect(() =>
      assertTargetHost(
        'local',
        'postgresql://postgres.ref:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
      ),
    ).toThrow(/local/);
  });

  it('비밀번호에 @ 가 섞여도 마지막 @ 뒤 host 로 판정한다', () => {
    expect(
      assertTargetHost(
        'prod',
        'postgresql://postgres.ref:p@ss@@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
      ),
    ).toBe('aws-1-ap-northeast-2.pooler.supabase.com');
    expect(assertTargetHost('local', 'postgresql://postgres:p@ss@127.0.0.1:54322/postgres')).toBe(
      '127.0.0.1',
    );
  });
});

describe('resolveOpsEnv — --env local 이 붙을 DB', () => {
  const LOCAL_SUPABASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const NATIVE = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
  const PROD = 'postgresql://postgres.ref:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres';
  function root(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'survey-ops-env-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return dir;
  }

  it('.env.local(로컬 supabase)을 .env(보통 닫힌 5432)보다 먼저 쓴다', () => {
    const dir = root({
      '.env.local': `DATABASE_URL=${LOCAL_SUPABASE}\n`,
      '.env': `DATABASE_URL=${NATIVE}\n`,
    });
    expect(resolveOpsEnv('local', dir, undefined)).toMatchObject({
      source: '.env.local',
      host: '127.0.0.1',
    });
  });

  it('.env.local 에 DATABASE_URL 이 없으면(주석) .env 로 넘어간다', () => {
    const dir = root({
      '.env.local': `# DATABASE_URL=${PROD}\nA=1\n`,
      '.env': `DATABASE_URL=${NATIVE}\n`,
    });
    expect(resolveOpsEnv('local', dir, undefined).source).toBe('.env');
  });

  it('SURVEY_OPS_DATABASE_URL 이 local DB 를 바꿔 끼운다 — db:isolated 의 전용 DB', () => {
    const dir = root({ '.env.local': `DATABASE_URL=${LOCAL_SUPABASE}\nOTHER=keep\n` });
    const isolated = 'postgresql://postgres:postgres@127.0.0.1:54322/survey_ops';
    const resolved = resolveOpsEnv('local', dir, isolated);
    expect(resolved).toMatchObject({ source: 'SURVEY_OPS_DATABASE_URL', host: '127.0.0.1' });
    expect(resolved.values).toMatchObject({ DATABASE_URL: isolated, OTHER: 'keep' });
  });

  it('덮어쓰기로 운영 URL 을 넣거나 prod 에서 쓰면 거부한다', () => {
    const dir = root({
      '.env.local': `DATABASE_URL=${LOCAL_SUPABASE}\n`,
      '.env.production': `DATABASE_URL=${PROD}\n`,
    });
    expect(() => resolveOpsEnv('local', dir, PROD)).toThrow(/local/);
    expect(() => resolveOpsEnv('prod', dir, LOCAL_SUPABASE)).toThrow(/--env local 에서만/);
  });

  it('어느 파일에도 없으면 후보를 이름으로 알린다', () => {
    expect(() => resolveOpsEnv('local', root({}), undefined)).toThrow(/\.env\.local · \.env/);
  });
});

type QuestionRow = typeof questions.$inferSelect;
type GroupRow = typeof questionGroups.$inferSelect;

function questionRow(
  partial: Partial<QuestionRow> & Pick<QuestionRow, 'id' | 'type' | 'title' | 'order'>,
): QuestionRow {
  return { surveyId: 'survey-1', ...partial } as QuestionRow;
}

describe('structureVariables — 내보내기와 같은 계산', () => {
  const radio = questionRow({
    id: 'q1',
    type: 'radio',
    title: '<p>만족도</p>',
    order: 1,
    questionCode: 'Q1',
    options: [
      { id: 'o1', label: '좋다', value: '1' },
      { id: 'o2', label: '나쁘다', value: '2' },
    ],
  } as Partial<QuestionRow> as QuestionRow);
  const checkbox = questionRow({
    id: 'q2',
    type: 'checkbox',
    title: '이용 경로',
    order: 2,
    questionCode: 'Q2',
    options: [
      { id: 'c1', label: '메일', value: '1' },
      { id: 'c2', label: '문자', value: '2' },
    ],
  } as Partial<QuestionRow> as QuestionRow);

  it('문항 코드로 변수명을 짓고 라벨에서 HTML 을 벗긴다', () => {
    const vars = structureVariables('survey-1', {
      questionRows: [radio, checkbox],
      groupRows: [] as GroupRow[],
    });
    expect(vars.map((v) => v.name)).toEqual(['Q1', 'Q2_1', 'Q2_2']);
    expect(vars[0]!.label.startsWith('만족도 / ')).toBe(true);
  });

  it('보기를 하나 지우면 그 변수명이 없어진 것으로 나온다 — 순서만 바뀐 것은 차이가 아니다', () => {
    const before = structureVariables('survey-1', {
      questionRows: [radio, checkbox],
      groupRows: [],
    });
    const fewer = { ...checkbox, options: [(checkbox.options as unknown[])[0]] } as QuestionRow;
    const after = structureVariables('survey-1', { questionRows: [radio, fewer], groupRows: [] });
    expect(diffVariables(before, after).removed.map((v) => v.name)).toEqual(['Q2_2']);
    expect(diffVariables(before, [...before].reverse())).toEqual({ removed: [], added: [] });
  });
});

describe('내보내기 라우트와 같은 사슬인가 — 라우트가 바뀌면 scripts/survey-ops/variables.ts 도 맞출 것', () => {
  const route = readFileSync(
    path.join(process.cwd(), 'src/app/api/surveys/[surveyId]/export/route.ts'),
    'utf8',
  );
  const tool = readFileSync(path.join(process.cwd(), 'scripts/survey-ops/variables.ts'), 'utf8');

  it('문항 준비: normalize → hydrate → 행 제외', () => {
    const chain =
      /applyExportRowExclusions\(\s*surveyId,\s*hydrateQuestionsForSpss\(normalizeQuestions\(/;
    expect(route).toMatch(chain);
    expect(tool).toMatch(chain);
  });

  it('언어 묶음을 넘긴다', () => {
    expect(route).toMatch(/loadLanguageSetLocales\(surveyId, hydratedQuestions\)/);
    expect(tool).toMatch(
      /resolveLanguageSetLocales\(prepared, rows\.groupRows\.map\(mapGroupRow\)\)/,
    );
  });
});

describe('pruneOldDumps — 명단 평문이 든 dump 를 7일 뒤 지운다', () => {
  it('7일 지난 .json 만 지운다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'survey-ops-'));
    const old = path.join(dir, 'old.json');
    const fresh = path.join(dir, 'fresh.json');
    const other = path.join(dir, 'note.txt');
    for (const f of [old, fresh, other]) writeFileSync(f, '{}');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(old, eightDaysAgo, eightDaysAgo);
    utimesSync(other, eightDaysAgo, eightDaysAgo);

    expect(pruneOldDumps(dir)).toEqual(['old.json']);
    expect([existsSync(old), existsSync(fresh), existsSync(other)]).toEqual([false, true, true]);
  });

  it('폴더가 없으면 아무것도 안 한다', () => {
    expect(pruneOldDumps(path.join(tmpdir(), 'no-such-survey-ops-dir'))).toEqual([]);
  });
});
