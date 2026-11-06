/**
 * 운영 설문 도구 공용 — 인자와 접속 대상.
 *
 * 앱 모듈(`@/db` 등)은 import 하는 순간 `process.env.DATABASE_URL` 로 접속을 만든다. 그래서 CLI 는
 * `loadOpsEnv` 로 env 를 먼저 채운 뒤 앱 모듈을 **동적 import** 해야 한다(정적 import 하면 셸의 env 로 붙는다).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type OpsEnv = 'prod' | 'local';

/**
 * env 별 파일 후보 — 앞에서부터 DATABASE_URL 이 있는 첫 파일을 쓴다.
 * - prod: `.env.production` 하나(운영).
 * - local: `.env.local`(로컬 supabase docker 54322) → `.env`(네이티브 5432 — 보통 닫혀 있다). Next dev 와 같은 순서다.
 * staging 은 활성 URL 이 어느 파일에도 없어(주석) 받지 않는다.
 */
const ENV_FILES: Record<OpsEnv, readonly string[]> = {
  prod: ['.env.production'],
  local: ['.env.local', '.env'],
};

/**
 * `--env local` 의 DB 만 바꿔 끼우는 변수 — `pnpm db:isolated <이름>` 이 내 주는 전용 DB URL 을 넣는다.
 * 로컬 host 만 받는다(운영 URL 을 여기로 넣어 local 가드를 우회하지 못하게).
 */
export const LOCAL_DATABASE_URL_OVERRIDE = 'SURVEY_OPS_DATABASE_URL';

export interface OpsArgs {
  env: OpsEnv;
  commit: boolean;
  allowVarChanges: boolean;
  /** `--` 로 시작하지 않는 인자 */
  positionals: string[];
  /** `--key value` · `--key=value` · 값 없는 `--flag`(true) */
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['env', 'resid', 'next', 'grep', 'out']);

export function parseOpsArgs(argv: readonly string[]): OpsArgs {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
    } else if (VALUE_FLAGS.has(body)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`--${body} 에 값이 없습니다`);
      flags.set(body, value);
      i++;
    } else {
      flags.set(body, true);
    }
  }
  const env = flags.get('env');
  if (env !== 'prod' && env !== 'local') {
    throw new Error(
      '--env prod 또는 --env local 을 꼭 적어 주세요 (어느 DB 에 붙을지 기본값을 두지 않습니다)',
    );
  }
  return {
    env,
    commit: flags.get('commit') === true,
    allowVarChanges: flags.get('allow-var-changes') === true,
    positionals,
    flags,
  };
}

/** KEY=VALUE 줄만 읽는다. 주석·빈 줄은 건너뛰고 값의 앞뒤 따옴표를 벗긴다. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** 대상 env 와 접속 host 가 맞는지 본다 — 운영인 줄 알고 로컬에, 로컬인 줄 알고 운영에 쓰지 않게. host 를 돌려준다. */
export function assertTargetHost(env: OpsEnv, databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error(`--env ${env} 의 DATABASE_URL 이 비었습니다`);
  // 비밀번호에 @ 가 섞여 URL 파싱이 갈릴 수 있어 마지막 @ 뒤만 본다.
  const afterAt = databaseUrl.slice(databaseUrl.lastIndexOf('@') + 1);
  const host = afterAt.split(/[:/]/)[0] ?? '';
  const isLocal = host === '127.0.0.1' || host === 'localhost';
  if (env === 'local' && !isLocal) throw new Error(`--env local 인데 접속 host 가 ${host} 입니다`);
  if (env === 'prod' && (isLocal || !host.endsWith('.supabase.com'))) {
    throw new Error(`--env prod 인데 접속 host 가 ${host} 입니다`);
  }
  return host;
}

/** 스크립트 로그가 운영 관측 도구로 나가지 않게 지우는 키 */
const SILENCED_KEYS = [
  'AXIOM_TOKEN',
  'AXIOM_DATASET',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
];

export interface ResolvedOpsEnv {
  /** 파일에서 읽은 값(덮어쓰기 반영) */
  values: Record<string, string>;
  /** DATABASE_URL 을 준 곳 — 파일 이름 또는 덮어쓰기 변수 이름 */
  source: string;
  host: string;
}

/** 어느 파일(또는 덮어쓰기)의 DATABASE_URL 로 붙을지 정한다 — 파일을 읽기만 하고 process.env 는 건드리지 않는다. */
export function resolveOpsEnv(
  env: OpsEnv,
  root = process.cwd(),
  override: string | undefined = process.env[LOCAL_DATABASE_URL_OVERRIDE],
): ResolvedOpsEnv {
  const candidates = ENV_FILES[env];
  const found = candidates
    .map((file) => ({ file, full: path.join(root, file) }))
    .filter(({ full }) => existsSync(full))
    .map(({ file, full }) => ({ file, values: parseEnvFile(readFileSync(full, 'utf8')) }))
    .find(({ values }) => values['DATABASE_URL']);
  if (override && env !== 'local') {
    throw new Error(`${LOCAL_DATABASE_URL_OVERRIDE} 는 --env local 에서만 쓴다`);
  }
  if (!found && !override)
    throw new Error(`${candidates.join(' · ')} 어디에도 DATABASE_URL 이 없습니다`);
  const values = { ...(found?.values ?? {}) };
  if (override) values['DATABASE_URL'] = override;
  const source = override ? LOCAL_DATABASE_URL_OVERRIDE : found!.file;
  return { values, source, host: assertTargetHost(env, values['DATABASE_URL']) };
}

/**
 * env 를 `process.env` 에 채운다(파일 값이 이긴다). 이 뒤에 앱 모듈을 동적 import 할 것.
 * 연결 문자열은 찍지 않고 host 와 출처만 돌려준다.
 */
export function loadOpsEnv(env: OpsEnv, root = process.cwd()): { host: string; file: string } {
  const { values, source, host } = resolveOpsEnv(env, root);
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  for (const k of SILENCED_KEYS) delete process.env[k];
  process.env['LOG_LEVEL'] ??= 'warn';
  return { host, file: source };
}

/** CLI 끝 처리 — 오류 문구만 찍고 종료 코드를 남긴다(스택은 SURVEY_OPS_DEBUG=1 일 때만). */
export function exitWithError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[실패] ${message}`);
  if (process.env['SURVEY_OPS_DEBUG'] === '1' && err instanceof Error) console.error(err.stack);
  process.exit(1);
}
