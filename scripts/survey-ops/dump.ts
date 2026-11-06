/**
 * 관리자 「설문 보기」가 보는 것을 파일로 내려받는다 — 같은 두 로더를 그대로 부른다
 * (`src/app/admin/surveys/[id]/preview/page.tsx`: getSurveyForResponse + loadPreviewContactSeed).
 *
 *   pnpm survey:dump <surveyId> --env prod [--published] [--test] [--resid N]
 *
 * - 기본은 저장본(테스트 버전) — 화면과 같이 `ensureTestVersion` 을 거치므로, 저장본이 바뀌었으면 테스트 버전
 *   행이 하나 생긴다(설문 보기 화면을 연 것과 같다). `--published` 는 배포본이라 아무것도 쓰지 않는다.
 * - 명단 값은 실데이터 파티션의 resid 가 가장 작은 대상(`--test` 면 테스트 파티션, `--resid` 로 지정).
 *
 * 파일에는 그 대상의 명단 평문(설문이 읽는 열만)이 들어 있다. gitignore 된 `.scratch/survey-ops/dumps/` 에만
 * 쓰고, 실행할 때마다 7일 지난 파일을 지운다. 그려 보기는 `pnpm survey:render <파일>`.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { exitWithError, loadOpsEnv, parseOpsArgs } from './env';

export const DUMP_DIR = path.join(process.cwd(), '.scratch', 'survey-ops', 'dumps');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneOldDumps(dir: string, now = Date.now()): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    if (now - statSync(full).mtimeMs > RETENTION_MS) {
      unlinkSync(full);
      removed.push(name);
    }
  }
  return removed;
}

async function main() {
  const args = parseOpsArgs(process.argv.slice(2));
  const surveyId = args.positionals[0];
  if (!surveyId) throw new Error('설문 id 를 적어 주세요: pnpm survey:dump <surveyId> --env prod');
  const published = args.flags.get('published') === true;
  const isTest = args.flags.get('test') === true;
  const residFlag = args.flags.get('resid');
  const resid = typeof residFlag === 'string' ? Number(residFlag) : undefined;
  if (resid !== undefined && !Number.isInteger(resid))
    throw new Error(`--resid 는 정수여야 합니다: ${residFlag}`);

  const { host } = loadOpsEnv(args.env);
  const { getSurveyForResponse } = await import('@/server/survey-builder/services/survey-read');
  const { loadPreviewContactSeed } = await import('@/server/contacts/services/preview-contact');

  const preview = await getSurveyForResponse(
    { surveyId },
    published ? {} : { useTestVersion: true },
  );
  if (!preview) throw new Error(`설문을 읽지 못했습니다: ${surveyId}`);
  const seed = await loadPreviewContactSeed({
    surveyId,
    isTest,
    structure: preview.survey,
    ...(resid !== undefined ? { resid } : {}),
  });
  if (resid !== undefined && !seed)
    throw new Error(`${isTest ? '테스트 ' : ''}조사 대상 #${resid} 가 없습니다`);

  mkdirSync(DUMP_DIR, { recursive: true });
  const pruned = pruneOldDumps(DUMP_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(
    DUMP_DIR,
    `${surveyId.slice(0, 8)}-${published ? 'published' : 'saved'}-${stamp}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        kind: 'survey-ops-dump',
        warning: '조사 대상 명단 평문이 들어 있다 — 공유·커밋 금지, 7일 뒤 다음 dump 때 지워진다',
        env: args.env,
        surveyId,
        source: published ? 'published' : 'saved',
        dumpedAt: new Date().toISOString(),
        versionId: preview.versionId,
        documentView: preview.documentView ?? null,
        survey: preview.survey,
        contact: seed ? { resid: seed.resid, isTest: seed.isTest } : null,
        contactAttrs: seed?.contactAttrs ?? null,
        priorAnswers: seed?.priorAnswers ?? null,
      },
      null,
      2,
    ),
  );

  const questions = (preview.survey as { questions?: unknown[] }).questions ?? [];
  console.log(`${args.env} (${host}) · ${preview.survey.title}`);
  console.log(
    `${published ? '배포본' : '저장본'} · 문항 ${questions.length}개 · 버전 ${preview.versionId ?? '없음'}`,
  );
  console.log(
    seed
      ? `명단 값: ${seed.isTest ? '테스트 ' : ''}조사 대상 #${seed.resid} · 열 ${Object.keys(seed.contactAttrs).length}개 · 이월 응답 ${seed.priorAnswers ? '있음' : '없음'}`
      : '명단 값: 조사 대상 없음 — 빈 명단 값으로 그려진다',
  );
  if (pruned.length > 0) console.log(`7일 지난 dump ${pruned.length}개를 지웠습니다`);
  console.log(`\n${path.relative(process.cwd(), file)}`);
  console.log(
    `그려 보기: pnpm survey:render ${path.relative(process.cwd(), file)} [--mobile] [--next N]`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('survey-ops', 'dump.ts'))) {
  main().then(
    () => process.exit(0),
    (err: unknown) => exitWithError(err),
  );
}
