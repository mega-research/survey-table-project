import { describe, it, expect, vi } from 'vitest';

/**
 * 봇 방어 — 허니팟. createResponseWithFirstAnswer / createBlankResponse 는 무인증 pub
 * procedure 라 봇이 RPC 를 직접 호출할 수 있다. honeypot 필드(실제 클라는 hidden 빈 값)가
 * 채워지면 봇으로 차단한다. 가드는 db/헤더 접근 전 최상단에서 return 하므로 최소 mock 으로 검증.
 *
 * clientSignals 부재(익명) 차단은 duplicate-blank-response-bypass-defense.test.ts 가 담당.
 * 차단 사유는 device_already_responded 로 통일 — 봇에게 탐지 사실을 노출하지 않음.
 */

process.env['DUPLICATE_DETECTION_SALT'] = 'test-salt';

// 차단 경로는 가드가 최상단에서 return 하므로 db 를 건드리지 않는다.
// 모듈 import 가 db/index.ts 의 DATABASE_URL throw 로 깨지지 않도록만 mock.
vi.mock('@/db', () => ({ db: {} }));

import {
  createResponseWithFirstAnswer,
  createBlankResponse,
} from '@/features/survey-response/server/services/response.service';

const VALID_SIGNALS = {
  deviceId: 'dev-1',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

describe('봇 방어 — honeypot', () => {
  it('createResponseWithFirstAnswer: honeypot 채워지면 차단한다', async () => {
    const res = await createResponseWithFirstAnswer({
      surveyId: 'survey-1',
      sessionId: 'sess-1',
      versionId: null,
      questionId: 'q1',
      value: 'a',
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      honeypot: 'http://spam.example',
    });
    expect(res.kind).toBe('blocked');
  });

  it('createBlankResponse: honeypot 채워지면 차단한다', async () => {
    const res = await createBlankResponse({
      surveyId: 'survey-1',
      sessionId: 'sess-1',
      versionId: null,
      currentStepId: 'step1',
      clientSignals: VALID_SIGNALS,
      honeypot: 'filled-by-bot',
    });
    expect(res.kind).toBe('blocked');
  });
});
