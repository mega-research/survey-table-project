import 'server-only';

import pino from 'pino';
import pretty from 'pino-pretty';

import { getAxiomOrNull } from './axiom';
import { serializeError } from './err-serializer';
import { REDACT_PATHS } from './redact';

/**
 * 서버 구조화 로거 (pino).
 *
 * env 3분기:
 * - dev                      → pino-pretty (in-process 스트림 — worker transport 금지,
 *                              Turbopack 모듈 해석 파손 이력: vercel/next.js#86099)
 * - 배포 + AXIOM 미설정      → stdout JSON (Vercel Runtime Logs)
 * - 배포 + AXIOM_TOKEN/DATASET → stdout JSON + Axiom 병행 (multistream — Axiom 장애
 *                              시에도 Vercel 쪽에 로그 생존)
 *
 * 로그 스키마 관례(allowlist): userId·role·ip·rpc/route·surveyId 등 식별자와 건수만
 * 바인딩한다. input/output 본문·JSONB 컨테이너·PII 평문은 싣지 않는다 — redact 는
 * 안전망일 뿐이다 (redact.ts 참조).
 */

const IS_DEV = process.env.NODE_ENV === 'development';

const LEVEL_LABEL: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Axiom ingest 스트림 — 메인 스레드 write, @axiomhq/js 내부 배칭. 비활성이면 null. */
function createAxiomStream(): pino.DestinationStream | null {
  const axiom = getAxiomOrNull();
  if (!axiom) return null;
  return {
    write(line: string) {
      try {
        const { time, level, ...rest } = JSON.parse(line) as {
          time: string;
          level: number;
          [key: string]: unknown;
        };
        axiom.client.ingest(axiom.dataset, {
          _time: time,
          level: LEVEL_LABEL[level] ?? level,
          ...rest,
        });
      } catch (err) {
        console.error('[axiom stream] 라인 처리 실패', err);
      }
    },
  };
}

/** 로거 생성. destination 주입은 테스트 전용 — 런타임은 인자 없이 env 로 분기한다. */
export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: process.env['LOG_LEVEL'] ?? (IS_DEV ? 'debug' : 'info'),
    redact: { paths: REDACT_PATHS },
    // err 바인딩은 반드시 이 serializer 를 거친다 — DrizzleQueryError 의
    // 쿼리 params(응답값·attrs) 유출 차단 (err-serializer.ts)
    serializers: { err: serializeError },
    timestamp: pino.stdTimeFunctions.isoTime,
    // pid/hostname 기본 바인딩 제거 — 서버리스에서 무의미
    base: null,
  };

  if (destination) return pino(options, destination);
  if (IS_DEV) return pino(options, pretty({ colorize: true }));

  const axiomStream = createAxiomStream();
  if (!axiomStream) return pino(options); // stdout 전용
  return pino(
    options,
    pino.multistream([{ stream: process.stdout }, { stream: axiomStream }]),
  );
}

export const logger = createLogger();
