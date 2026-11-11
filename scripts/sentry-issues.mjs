// Sentry 이슈를 읽기 전용으로 조회한다 — 「Sentry 에 이런 오류가 떴다」를 제목만으로 추적하지 않게.
//
// 사용:
//   pnpm sentry:issues                      # 미해결 이슈 20건 (최근 14일, 많이 난 순)
//   pnpm sentry:issues --query "연락금지"    # 검색어 (Sentry 검색 문법 그대로)
//   pnpm sentry:issues <이슈 id>            # 그 이슈의 최근 이벤트 — 태그(rpc·code·surveyId)·스택 위쪽
//
// 토큰은 .env.local 의 SENTRY_READ_TOKEN 을 쓰고, 없으면 SENTRY_AUTH_TOKEN 을 쓴다. 후자는 소스맵
// 업로드용이라 이슈를 읽을 권한이 없어 403 이 난다(2026-11-11 확인) — Sentry 의 User Auth Tokens 에서
// event:read · org:read · project:read 만 준 토큰을 만들어 SENTRY_READ_TOKEN 으로 .env.local 에 둔다.
// GET 만 보낸다. 이벤트 본문은 터미널에만 찍고 파일로 남기지 않는다.
import { readFileSync } from 'node:fs';

function readEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

const fileEnv = { ...readEnvFile('.env'), ...readEnvFile('.env.local') };
const env = (key) => process.env[key] ?? fileEnv[key];

const token = env('SENTRY_READ_TOKEN') ?? env('SENTRY_AUTH_TOKEN');
const project = env('SENTRY_PROJECT');
if (!token || !project) {
  console.error('SENTRY_READ_TOKEN · SENTRY_PROJECT 가 .env 또는 .env.local 에 있어야 합니다.');
  process.exit(2);
}

// 리전은 DSN 호스트가 말해 준다 (…ingest.de.sentry.io → de.sentry.io).
const dsn = env('NEXT_PUBLIC_SENTRY_DSN') ?? '';
const base = /\.de\.sentry\.io/.test(dsn) ? 'https://de.sentry.io' : 'https://sentry.io';

async function get(path) {
  const res = await fetch(`${base}/api/0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    console.error(
      `Sentry 가 ${res.status} 를 돌려줬습니다 — 이 토큰에 이슈를 읽을 권한이 없습니다.\n` +
        '  Sentry > User Auth Tokens 에서 event:read · org:read · project:read 토큰을 만들어\n' +
        '  .env.local 에 SENTRY_READ_TOKEN=<토큰> 으로 넣으세요.',
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Sentry 조회 실패: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

// 조직 슬러그는 env 의 SENTRY_ORG 를 믿지 않고 토큰이 보는 프로젝트 목록에서 푼다 — 로컬 env 의
// SENTRY_ORG 가 실제 슬러그와 달라 모든 조회가 403 이던 적이 있다(2026-11-11).
const projects = await get('/projects/');
const org = projects.find((p) => p.slug === project)?.organization?.slug;
if (!org) {
  console.error(`이 토큰이 볼 수 있는 프로젝트에 '${project}' 가 없습니다 (SENTRY_PROJECT 확인).`);
  process.exit(1);
}

const args = process.argv.slice(2);
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx + 1] : null;
const issueId = args.find((a, i) => /^\d+$/.test(a) && i !== queryIdx + 1);

if (issueId) {
  const event = await get(`/organizations/${org}/issues/${issueId}/events/latest/`);
  const tags = Object.fromEntries((event.tags ?? []).map((t) => [t.key, t.value]));
  const pick = ['rpc', 'code', 'role', 'surveyId', 'pg_code', 'environment', 'release', 'url'];
  console.log(`${event.title}`);
  console.log(`  시각 ${event.dateCreated} · 이벤트 ${event.eventID}`);
  console.log(`  태그 ${pick.filter((k) => tags[k]).map((k) => `${k}=${tags[k]}`).join(' · ') || '(없음)'}`);
  const detail = event.contexts?.detail;
  if (detail) console.log(`  detail ${JSON.stringify(detail)}`);
  const frames = (event.entries ?? [])
    .filter((e) => e.type === 'exception')
    .flatMap((e) => e.data?.values ?? [])
    .flatMap((v) => (v.stacktrace?.frames ?? []).filter((f) => f.inApp).slice(-6).reverse());
  for (const f of frames) console.log(`    ${f.filename}:${f.lineNo}  ${f.function ?? ''}`);
} else {
  const search = encodeURIComponent(`is:unresolved${query ? ` ${query}` : ''}`);
  const issues = await get(
    `/projects/${org}/${project}/issues/?query=${search}&statsPeriod=14d&sort=freq&limit=20`,
  );
  if (issues.length === 0) console.log('해당하는 미해결 이슈가 없습니다.');
  for (const it of issues) {
    console.log(`${it.id}  ×${it.count}  ${it.lastSeen.slice(0, 16)}  ${it.title}`);
    if (it.culprit) console.log(`          ${it.culprit}`);
  }
}
