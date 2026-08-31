import 'server-only';

import { isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import {
  mailCampaigns,
  mailTemplates,
  questions,
  savedCells,
  savedLookups,
  savedQuestions,
  surveyDocuments,
  surveys,
  surveyVersions,
} from '@/db/schema';

/**
 * R2 참조 표면의 단일 정의(SSOT).
 *
 * 집행 직전 전역 참조 재확인(reference-scan)과 파생 참조 인덱스 재구축
 * (key-ref-index)은 **같은 표면·같은 술어**를 봐야 한다. 두 목록이 갈리면
 * 인덱스가 스캔보다 넓어지고, 인덱스 히트는 후보를 '보존됨'(종결 상태)으로
 * 닫아버리므로 스캔이라면 허용했을 삭제가 영구히 막힌다 — 되돌릴 재시도
 * 경로가 없다. ADR 0015 의 "수집·재확인·인덱스는 같은 추출 의미론을
 * 공유한다" 계약을 표면 수준으로 한 단계 올린 것이다.
 *
 * mail_recipients.sendPayloadSnapshot 은 캠페인 스냅샷과 키 집합이 동일하고
 * (수신자별 토큰 치환만 다름) 발송분 보호는 발송 장부 소관이라 표면에 없다.
 */
export interface R2ReferenceSource {
  /** r2_key_refs.source_table 값 — DB 테이블명과 일치시킨다. */
  name: string;
  table: PgTable;
  /**
   * 표면 술어 — 이 조건을 만족하는 행만 참조 자격이 있다.
   * - mail_templates: soft delete 된 행은 파일 참조 자격을 잃는다 (CONTEXT.md)
   * - survey_versions: 보존 정책으로 정리된 행(snapshot IS NULL)은 참조를
   *   주장하지 않는다. 정리 시점에 그 키들을 이미 유예 큐에 등록했다.
   */
  extraWhere?: SQL;
  /**
   * append-only 로 취급하는 소스 — 삽입 시 1회 인덱스에 기록하고 일일
   * 리빌드에서 제외한다. 대형 스냅샷을 매일 다시 읽지 않는 것이 비용의
   * 핵심이다 (spec 6.2). 월 1회 감사에서만 전량 재추출한다.
   */
  immutable?: boolean;
}

export const REFERENCE_SURFACE: readonly R2ReferenceSource[] = [
  { name: 'surveys', table: surveys },
  { name: 'questions', table: questions },
  // 조사표 PDF (0084). file_key 가 bare 키라 행 전체 스캔의 게이트를 그대로 통과한다.
  // 등재를 빠뜨리면 조사표가 유예 기간 뒤 삭제 큐에서 조용히 사라진다.
  { name: 'survey_documents', table: surveyDocuments },
  {
    name: 'survey_versions',
    table: surveyVersions,
    extraWhere: isNotNull(surveyVersions.snapshot),
    immutable: true,
  },
  { name: 'saved_questions', table: savedQuestions },
  { name: 'saved_cells', table: savedCells },
  { name: 'saved_lookups', table: savedLookups },
  { name: 'mail_templates', table: mailTemplates, extraWhere: isNull(mailTemplates.deletedAt) },
  { name: 'mail_campaigns', table: mailCampaigns },
];

/**
 * 일일 전량 재추출 대상. 가변 소스 + 작아서 굳이 증분 처리할 이유가 없는 소스.
 * 2026-07-31 실측 전량 추출 약 5초 (mail_campaigns 는 439kB / 79ms 로 무시 가능).
 *
 * mail_campaigns 는 스냅샷 컬럼이 불변이지만 여기에 둔다 — 크기가 작아 매일
 * 다시 읽어도 비용이 없고, 캠페인 생성 경로마다 기록을 심는 것보다 누락
 * 위험이 없다. 증분 처리가 필요한 것은 survey_versions 뿐이다.
 */
export const MUTABLE_SOURCES: readonly R2ReferenceSource[] = REFERENCE_SURFACE.filter(
  (source) => !source.immutable,
);

/** 불변 소스 — 발행 시 1회 기록하고 월 1회 감사에서만 재추출한다. */
export const IMMUTABLE_SOURCES: readonly R2ReferenceSource[] = REFERENCE_SURFACE.filter(
  (source) => source.immutable,
);
