/**
 * 운영 설문 고치기 도우미 CLI 진입점 — 사용법과 동작은 `patch-core.ts` 머리 주석.
 *
 * 이 파일은 앱 모듈을 정적으로 import 하지 않는다. `@/db` 는 import 되는 순간 `process.env.DATABASE_URL`
 * 로 접속을 만들기 때문에, `loadOpsEnv` 로 env 를 채운 다음 동적 import 한다.
 */
import { type OpsArgs, exitWithError, loadOpsEnv, parseOpsArgs } from './env';
import type { SurveyPatch } from './patch-core';

export type { PatchContext, SurveyPatch } from './patch-core';

/** CLI 진입점 — 인자를 읽고 env 를 채운 뒤 앱 DB 로 executeSurveyPatch 를 돌린다. */
export function runSurveyPatch(
  patch: SurveyPatch,
  argv: readonly string[] = process.argv.slice(2),
): void {
  void (async () => {
    let args: OpsArgs;
    try {
      args = parseOpsArgs(argv);
    } catch (err) {
      exitWithError(err);
    }
    const { host, file: envSource } = loadOpsEnv(args.env);
    console.log(
      `접속: ${args.env} (${host} · ${envSource})${args.commit ? ' · 커밋' : ' · 시험 실행'}`,
    );
    // env 를 채운 뒤에 앱 DB 를 연다(정적 import 면 셸 env 로 붙는다).
    const { db } = await import('@/db');
    const { executeSurveyPatch } = await import('./patch-core');
    try {
      const result = await executeSurveyPatch(db, patch, {
        commit: args.commit,
        allowVarChanges: args.allowVarChanges,
      });
      if (result.outcome === 'committed') {
        console.log(
          '커밋했습니다. 미리보기·테스트 링크에는 바로, 실제 응답자에게는 다시 발행해야 보입니다.',
        );
        console.log(
          '빌더 탭을 열어 두었다면 새로고침한 뒤 저장하세요 — 옛 탭 저장이 이 수정을 덮습니다.',
        );
      }
      process.exit(result.outcome === 'rejected-var-change' ? 3 : 0);
    } catch (err) {
      exitWithError(err);
    }
  })();
}
