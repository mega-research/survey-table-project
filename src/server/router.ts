import { analytics } from '@/features/analytics/server/procedures/analytics';
import { auth } from '@/features/auth/server/procedures/auth';
import { attempts } from '@/features/contacts/server/procedures/attempts';
import { attrs } from '@/features/contacts/server/procedures/attrs';
import { columns } from '@/features/contacts/server/procedures/columns';
import { resultCodes } from '@/features/contacts/server/procedures/result-codes';
import { targets } from '@/features/contacts/server/procedures/targets';
import { uploads } from '@/features/contacts/server/procedures/uploads';
import { transfer } from '@/features/library/server/procedures/library-transfer';
import { questionCategories } from '@/features/library/server/procedures/question-categories';
import { savedCells } from '@/features/library/server/procedures/saved-cells';
import { savedLookups } from '@/features/library/server/procedures/saved-lookups';
import { savedQuestions } from '@/features/library/server/procedures/saved-questions';
import { groups } from '@/features/survey-builder/server/procedures/groups';
import { lookups } from '@/features/survey-builder/server/procedures/lookups';
import { publicRead } from '@/features/survey-builder/server/procedures/public-read';
import { publish } from '@/features/survey-builder/server/procedures/publish';
import { questions } from '@/features/survey-builder/server/procedures/questions';
import { read } from '@/features/survey-builder/server/procedures/read';
import { save } from '@/features/survey-builder/server/procedures/save';
import { surveys } from '@/features/survey-builder/server/procedures/surveys';
import { testSample } from '@/features/survey-builder/server/procedures/test-sample';
import { billing } from '@/features/mail/server/procedures/billing';
import { campaigns } from '@/features/mail/server/procedures/campaigns';
import { preview } from '@/features/mail/server/procedures/preview';
import { templates } from '@/features/mail/server/procedures/templates';
import { unsubscribe } from '@/features/mail/server/procedures/unsubscribe';
import { media } from '@/features/media/server/procedures/media';
import { progress } from '@/features/operations/server/procedures/progress';
import { duplicate } from '@/features/survey-response/server/procedures/duplicate';
import { edit } from '@/features/survey-response/server/procedures/edit';
import { lifecycle } from '@/features/survey-response/server/procedures/lifecycle';
import { manage } from '@/features/survey-response/server/procedures/manage';
import { response } from '@/features/survey-response/server/procedures/response';

import { health } from './procedures/health';

export const router = {
  health,
  library: {
    savedQuestions,
    savedLookups,
    savedCells,
    questionCategories,
    transfer,
  },
  surveyBuilder: {
    surveys,
    save,
    publish,
    questions,
    groups,
    read,
    publicRead,
    lookups,
    testSample,
  },
  auth,
  media,
  analytics,
  contacts: {
    targets,
    columns,
    uploads,
    attempts,
    resultCodes,
    attrs,
  },
  mail: {
    templates,
    preview,
    campaigns,
    billing,
    unsubscribe,
  },
  surveyResponse: {
    response,
    lifecycle,
    duplicate,
    edit,
    manage,
  },
  operations: {
    progress,
  },
};

export type AppRouter = typeof router;
