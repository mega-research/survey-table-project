import { describe, expect, it } from 'vitest';

import {
  evaluateAuditReport,
  parseAllowlist,
} from '../../../.github/audit-gate';

// pnpm 8 정상 보고서 골격(취약점 0건). advisories + metadata.vulnerabilities 가 모두 존재.
function cleanReport() {
  return {
    actions: [],
    advisories: {},
    muted: [],
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    },
  };
}

describe('evaluateAuditReport', () => {
  it('취약점이 없는 정상 보고서는 ok 를 반환한다', () => {
    const result = evaluateAuditReport(JSON.stringify(cleanReport()), new Set());
    expect(result.kind).toBe('ok');
  });

  it('allowlist 밖 high 취약점이 있으면 blocked 를 반환한다', () => {
    const report = cleanReport();
    report.advisories = {
      '1': {
        severity: 'high',
        github_advisory_id: 'GHSA-new-high-0001',
        module_name: 'evil-pkg',
      },
    } as never;
    const result = evaluateAuditReport(JSON.stringify(report), new Set());
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0]?.id).toBe('GHSA-new-high-0001');
      expect(result.blocking[0]?.pkg).toBe('evil-pkg');
    }
  });

  it('high 취약점이 allowlist 에 있으면 ok 를 반환한다', () => {
    const report = cleanReport();
    report.advisories = {
      '1': {
        severity: 'high',
        github_advisory_id: 'GHSA-known-0001',
        module_name: 'transitive-pkg',
      },
    } as never;
    const result = evaluateAuditReport(
      JSON.stringify(report),
      new Set(['GHSA-known-0001'])
    );
    expect(result.kind).toBe('ok');
  });

  it('moderate 취약점은 게이트를 막지 않는다(high 미만)', () => {
    const report = cleanReport();
    report.advisories = {
      '1': {
        severity: 'moderate',
        github_advisory_id: 'GHSA-jggg-4jg4-v7c6',
        module_name: 'protobufjs',
      },
    } as never;
    const result = evaluateAuditReport(JSON.stringify(report), new Set());
    expect(result.kind).toBe('ok');
  });

  // 회귀 방지: 레지스트리 도달 실패 시 pnpm audit 은 error JSON 을 뱉고 exit 1.
  // 이 출력을 정상 보고서로 다루면 vacuous PASS(fail-open) 가 된다. 반드시 audit-failure.
  it('error 키가 있는 레지스트리 실패 출력은 fail-closed(audit-failure) 한다', () => {
    const errorReport = {
      error: {
        code: 'ECONNREFUSED',
        summary:
          'request to https://registry.example/-/npm/v1/security/audits failed, reason: connect ECONNREFUSED',
        detail: '',
      },
    };
    const result = evaluateAuditReport(JSON.stringify(errorReport), new Set());
    expect(result.kind).toBe('audit-failure');
  });

  it('advisories 키가 없는 불완전 보고서는 fail-closed 한다', () => {
    const partial = {
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      },
    };
    const result = evaluateAuditReport(JSON.stringify(partial), new Set());
    expect(result.kind).toBe('audit-failure');
  });

  it('metadata.vulnerabilities 가 없는 불완전 보고서는 fail-closed 한다', () => {
    const partial = { advisories: {} };
    const result = evaluateAuditReport(JSON.stringify(partial), new Set());
    expect(result.kind).toBe('audit-failure');
  });

  it('빈 객체(advisories·metadata 모두 없음)는 fail-closed 한다', () => {
    const result = evaluateAuditReport('{}', new Set());
    expect(result.kind).toBe('audit-failure');
  });

  it('빈 파일(파싱 실패)은 예외를 던진다(게이트 실패)', () => {
    expect(() => evaluateAuditReport('', new Set())).toThrow();
  });
});

describe('parseAllowlist', () => {
  it('공백 구분 GHSA id 목록을 Set 으로 파싱한다', () => {
    const set = parseAllowlist('  GHSA-aaa  GHSA-bbb\n GHSA-ccc ');
    expect(set).toEqual(new Set(['GHSA-aaa', 'GHSA-bbb', 'GHSA-ccc']));
  });

  it('undefined 는 빈 Set 으로 처리한다', () => {
    expect(parseAllowlist(undefined)).toEqual(new Set());
  });
});
