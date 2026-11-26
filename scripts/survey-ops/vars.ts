/**
 * 설문 구조의 SPSS 변수명 목록 — 내보내기와 같은 계산(`variables.ts`).
 *
 *   pnpm survey:vars <surveyId> --env prod [--grep 'Q2_r0[12]'] [--names]
 *
 * `--names` 는 문항별 한 줄에 이름만 낸다 — 라벨이 필요 없을 때 출력이 열 배쯤 짧다.
 *
 * 변수명을 설명할 때는 짓지 말고 이 출력을 그대로 인용한다. 응답에 따라 빠지는 열(안 쓴 벌·열)과
 * 변동 확인 열은 들어 있지 않다.
 */
import { exitWithError, loadOpsEnv, parseOpsArgs } from './env';

void (async () => {
  try {
    const args = parseOpsArgs(process.argv.slice(2));
    const surveyId = args.positionals[0];
    if (!surveyId)
      throw new Error('설문 id 를 적어 주세요: pnpm survey:vars <surveyId> --env prod');
    const { host, file: envSource } = loadOpsEnv(args.env);
    const { db } = await import('@/db');
    const { formatVariableNames, loadStructureRows, structureVariables, surveyTitle } =
      await import('./variables');

    const title = await surveyTitle(db, surveyId);
    if (title === null) throw new Error(`설문이 없습니다: ${surveyId}`);
    const rows = await loadStructureRows(db, surveyId);
    const vars = structureVariables(surveyId, rows);
    const grep = args.flags.get('grep');
    const pattern = typeof grep === 'string' ? new RegExp(grep) : null;
    const shown = pattern ? vars.filter((v) => pattern.test(v.name)) : vars;

    console.log(`${args.env} (${host} · ${envSource}) · ${title}`);
    console.log(
      `변수 ${vars.length}개${pattern ? ` 중 ${shown.length}개 (${pattern.source})` : ''}`,
    );
    const short = (s: string) => (s.length > 90 ? `${s.slice(0, 89)}…` : s);
    if (args.flags.get('names') === true) {
      const codes = new Map(
        rows.questionRows.flatMap((q) => (q.questionCode ? [[q.id, q.questionCode] as const] : [])),
      );
      for (const line of formatVariableNames(shown, codes)) console.log(line);
    } else {
      for (const v of shown) console.log(`${v.name}\t${short(v.label)}`);
    }
    process.exit(0);
  } catch (err) {
    exitWithError(err);
  }
})();
