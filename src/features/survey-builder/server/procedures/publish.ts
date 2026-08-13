import { ORPCError } from '@orpc/server';

import { isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import { authed } from '@/server/orpc';

import {
  MigratableCountInput,
  MigratableCountOutput,
  PublishSurveyInput,
  SurveyVersionRowSchema,
} from '../../domain/survey-publish';
import * as svc from '../services/survey-publish.service';

/**
 * 설문 배포 procedure (authed).
 * 단일 트랜잭션으로 기존 published -> superseded, versionNumber=max+1,
 * currentVersionId 갱신을 보장(불변식 C).
 * SpssVarNameError는 BAD_REQUEST + issues 배열로 클라이언트에 전달.
 */
const publishSurvey = authed
  .input(PublishSurveyInput)
  .output(SurveyVersionRowSchema)
  .handler(async ({ input }) => {
    try {
      return await svc.publishSurvey(input);
    } catch (error) {
      if (isSpssVarNameError(error)) {
        throw new ORPCError('BAD_REQUEST', {
          message: error.message,
          data: { issues: error.issues },
        });
      }
      throw error;
    }
  });

/**
 * 배포 확인 안내용 이관 대상 응답 수 (ADR-0014).
 * "진행 중 응답 N건이 새 버전으로 이어집니다" 문구의 N.
 */
const migratableCount = authed
  .input(MigratableCountInput)
  .output(MigratableCountOutput)
  .handler(({ input }) => svc.countMigratableResponses(input));

export const publish = {
  publish: publishSurvey,
  migratableCount,
};
