import { authed } from '@/server/orpc';

import { PublishSurveyInput, SurveyVersionRowSchema } from '../../domain/survey-publish';
import * as svc from '../services/survey-publish.service';

/**
 * 설문 배포 procedure (authed).
 * 단일 트랜잭션으로 기존 published -> superseded, versionNumber=max+1,
 * currentVersionId 갱신을 보장(불변식 C).
 */
const publishSurvey = authed
  .input(PublishSurveyInput)
  .output(SurveyVersionRowSchema)
  .handler(({ input }) => svc.publishSurvey(input));

export const publish = {
  publish: publishSurvey,
};
