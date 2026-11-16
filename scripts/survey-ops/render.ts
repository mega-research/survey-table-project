/**
 * 응답 화면처럼 그려 보기 — `pnpm survey:dump` 로 받은 파일을 「설문 보기」와 같은 컴포넌트로 jsdom 에 그려
 * 보이는 글자와 입력 상태를 찍는다.
 *
 *   pnpm survey:render <dump.json> [--mobile] [--next N] [--answers answers.json] [--click <칸 id>[,<칸 id>…]]
 *
 * `--next N` 은 「다음」을 N 번 누른다. 필수·검증에 막히면 그 화면(오류 문구 포함)을 찍고 멈춘다.
 * `--answers` 는 처음부터 깔아 둘 응답 — `{ "SQ1": {...}, "Q2": "1" }` 처럼 문항 코드(또는 문항 id)를 키로 쓴다.
 * 필수 쪽을 넘겨 뒤쪽 쪽을 볼 때 쓴다. 값 모양은 응답 저장 모양 그대로다(표는 칸 id → 값).
 * `--click` 은 「다음」을 다 누른 뒤 그 쪽에서 표 칸의 체크박스·라디오를 적은 순서대로 누르고, 누르기 전과 달라진
 * 줄만 찍는다 — 따라 선택·단독 선택처럼 「누르면 다른 칸이 바뀌는」 설정이 실제로 동작하는지 볼 때 쓴다.
 * DB 에 붙지 않는다 — dump 파일만 읽는다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--next', '--answers', '--click']);
const dump = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1] ?? ''));
const mobile = argv.includes('--mobile');
const nextIdx = argv.indexOf('--next');
const next = nextIdx >= 0 ? Number(argv[nextIdx + 1]) : 0;
const answersIdx = argv.indexOf('--answers');
const answers = answersIdx >= 0 ? argv[answersIdx + 1] : undefined;
const clickIdx = argv.indexOf('--click');
const click = clickIdx >= 0 ? argv[clickIdx + 1] : undefined;

if (!dump || !existsSync(dump)) {
  console.error(
    'dump 파일을 적어 주세요: pnpm survey:render .scratch/survey-ops/dumps/<파일>.json [--mobile] [--next N] [--click <칸 id>]',
  );
  process.exit(1);
}
if (answers !== undefined && !existsSync(answers)) {
  console.error(`--answers 파일이 없습니다: ${answers}`);
  process.exit(1);
}
if (clickIdx >= 0 && (!click || click.startsWith('--'))) {
  console.error('--click 뒤에 칸 id 를 적어 주세요 (여럿이면 쉼표로)');
  process.exit(1);
}
if (!Number.isInteger(next) || next < 0) {
  console.error('--next 는 0 이상의 정수여야 합니다');
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), 'survey-render-'));
const out = path.join(dir, 'out.txt');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'scripts/survey-ops/vitest.render.config.ts'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      ...process.env,
      SURVEY_OPS_DUMP: path.resolve(dump),
      SURVEY_OPS_OUT: out,
      SURVEY_OPS_MOBILE: mobile ? '1' : '0',
      SURVEY_OPS_NEXT: String(next),
      ...(answers ? { SURVEY_OPS_ANSWERS: path.resolve(answers) } : {}),
      ...(click ? { SURVEY_OPS_CLICK: click } : {}),
    },
  },
);

if (existsSync(out)) {
  process.stdout.write(readFileSync(out, 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
// 그리기 전에 실패 — vitest 출력을 그대로 보여 준다
process.stderr.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
