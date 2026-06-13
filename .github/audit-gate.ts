// 공급망 보안 감사 게이트 — pnpm audit JSON 출력 평가기.
//
// pnpm 8 의 `pnpm audit --audit-level=high --json` 은 취약점이 발견되면 exit 1 로
// 종료하므로 CI 에서는 `|| true` 로 exit code 를 흡수하고 JSON 을 직접 파싱한다.
// 그런데 audit 은 GitHub Advisory 레지스트리에 도달하지 못하면(ECONNREFUSED,
// 타임아웃, rate limit, DNS 등) `{ "error": { ... } }` 형태의 JSON 을 stdout 에
// 쓰고 exit 1 로 종료한다. 이 출력을 정상 보고서처럼 다루면 advisories 가 비어
// 있어 게이트가 vacuous PASS 가 된다(fail-open). 이 모듈은 그런 보고서를 명시적인
// 감사 실패로 분류해 fail-closed 시킨다.
//
// 평가 결과는 판별 유니언으로 반환하고, 실제 종료 코드 결정은 main() 이 담당한다.

/** pnpm audit 의 단일 advisory(우리가 사용하는 필드만 좁게 모델링). */
interface AuditAdvisory {
  severity?: string;
  github_advisory_id?: string;
  url?: string;
  module_name?: string;
}

/** pnpm 8 audit 의 정상 보고서 형태(우리가 검사하는 필드만). */
interface AuditReport {
  advisories?: Record<string, AuditAdvisory>;
  metadata?: {
    vulnerabilities?: Record<string, number>;
  };
  error?: unknown;
}

/** 게이트가 막는 단일 취약점 요약. */
export interface BlockingAdvisory {
  id: string;
  pkg: string;
  sev: string;
}

/** 감사 게이트 평가 결과. */
export type AuditGateResult =
  | { kind: 'ok' }
  | { kind: 'blocked'; blocking: BlockingAdvisory[] }
  | { kind: 'audit-failure'; reason: string };

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/**
 * 보고서가 레지스트리 실패 등 비정상 출력인지 판정한다.
 *
 * 정상 pnpm 8 보고서는 최상위에 `advisories` 와 `metadata.vulnerabilities` 를
 * 함께 가진다(취약점 0건이어도 두 키 모두 존재). 둘 중 하나라도 없거나 `error`
 * 키가 있으면 audit 이 권고를 수집하지 못한 것으로 보고 fail-closed 한다.
 */
function detectAuditFailure(report: AuditReport): string | null {
  if (report.error !== undefined) {
    return 'audit 출력에 error 키가 있습니다(레지스트리 도달 실패로 추정).';
  }
  const hasAdvisories =
    report.advisories !== undefined && report.advisories !== null;
  const hasVulnSummary =
    report.metadata?.vulnerabilities !== undefined &&
    report.metadata.vulnerabilities !== null;
  if (!hasAdvisories || !hasVulnSummary) {
    return 'audit 출력에 advisories 또는 metadata.vulnerabilities 가 없습니다(불완전/비정상 보고서).';
  }
  return null;
}

/**
 * pnpm audit JSON 문자열을 평가한다.
 *
 * - JSON 파싱 실패: 호출자에게 throw 를 전파(빈 파일 등 → 게이트 실패).
 * - 레지스트리 실패/불완전 보고서: `audit-failure` (fail-closed).
 * - allowlist 밖 high/critical 존재: `blocked`.
 * - 그 외: `ok`.
 */
export function evaluateAuditReport(
  rawJson: string,
  allowlist: ReadonlySet<string>
): AuditGateResult {
  const report = JSON.parse(rawJson) as AuditReport;

  const failureReason = detectAuditFailure(report);
  if (failureReason !== null) {
    return { kind: 'audit-failure', reason: failureReason };
  }

  const advisories = Object.values(report.advisories ?? {});
  const blocking = advisories
    .filter((a) => BLOCKING_SEVERITIES.has(a.severity ?? ''))
    .map<BlockingAdvisory>((a) => ({
      id: a.github_advisory_id || (a.url ?? '').split('/').pop() || '',
      pkg: a.module_name ?? '(unknown)',
      sev: a.severity ?? '(unknown)',
    }))
    .filter((a) => !allowlist.has(a.id));

  if (blocking.length > 0) {
    return { kind: 'blocked', blocking };
  }
  return { kind: 'ok' };
}

/** AUDIT_ALLOWLIST 환경변수(공백 구분)를 Set 으로 파싱한다. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(/\s+/).filter(Boolean));
}

/**
 * CI 진입점: argv[2] 의 파일을 읽어 평가하고 종료 코드를 정한다.
 * 파싱 자체가 실패하면(빈 파일 등) 예외가 전파되어 비정상 종료(게이트 실패)한다.
 */
async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('사용법: tsx .github/audit-gate.ts <audit-report.json>');
    process.exit(1);
  }
  const allowlist = parseAllowlist(process.env['AUDIT_ALLOWLIST']);
  const raw = readFileSync(reportPath, 'utf8');
  const result = evaluateAuditReport(raw, allowlist);

  switch (result.kind) {
    case 'audit-failure':
      console.error('감사 게이트 실패: audit 보고서가 비정상입니다(fail-closed).');
      console.error(`  사유: ${result.reason}`);
      console.error(
        '레지스트리 장애일 수 있습니다. 런을 재시도하거나 audit 출력을 확인하세요.'
      );
      process.exit(1);
      break;
    case 'blocked':
      console.error('Allowlist 에 없는 high/critical 취약점이 발견되었습니다:');
      for (const b of result.blocking) {
        console.error(`  ${b.sev} ${b.pkg} ${b.id}`);
      }
      console.error(
        '의존성을 패치하거나, unfixable transitive 라면 사유와 함께 allowlist 에 추가하세요.'
      );
      process.exit(1);
      break;
    case 'ok':
      console.log('감사 게이트 통과: allowlist 외 high/critical 취약점 없음.');
      break;
  }
}

// CLI 로 직접 실행될 때만 main() 을 호출한다(테스트 import 시에는 실행하지 않음).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('audit-gate.ts') || invokedPath.endsWith('audit-gate.mts')) {
  void main();
}
