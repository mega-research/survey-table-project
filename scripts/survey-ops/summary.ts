/**
 * 설문 구조 요약 — 문항당 한 줄. dump JSON 을 직접 뒤지지 않고 구조를 본다.
 *
 *   pnpm survey:summary <surveyId> --env prod|local [--grep '^B'] [--detail A3]
 *   pnpm survey:summary --file .scratch/<설문>/out.json [--grep …] [--detail …]
 *
 * `--grep` 은 문항코드로 거르고, `--detail <문항코드>` 는 그 문항 하나를 편다(열 · 보기 그룹 · 줄마다 칸 ·
 * 검증). DB 는 읽기만 한다. 줄 모양은 `summary-core.ts`.
 */
import { parseCheckArgs } from './check-core';
import { exitWithError, parseOpsFlags } from './env';
import { loadStructure } from './structure-source';
import { describeQuestion, summarizeStructure } from './summary-core';

void (async () => {
  try {
    const argv = process.argv.slice(2);
    const { flags } = parseOpsFlags(argv);
    const loaded = await loadStructure(parseCheckArgs(argv));
    const input = { questions: loaded.questions, groups: loaded.groups };
    const detail = flags.get('detail');
    const grep = flags.get('grep');
    const lines =
      typeof detail === 'string'
        ? [loaded.title, ...describeQuestion(input, detail)]
        : summarizeStructure(input, loaded.title, {
            ...(typeof grep === 'string' ? { grep: new RegExp(grep) } : {}),
          });
    console.log(lines.join('\n'));
    process.exit(0);
  } catch (err) {
    exitWithError(err);
  }
})();
