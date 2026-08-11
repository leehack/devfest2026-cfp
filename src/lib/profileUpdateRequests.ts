import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';
import type { ProfileUpdateRequestSummary } from './profileUpdateRequestSummary';

export type { ProfileUpdateRequestSummary } from './profileUpdateRequestSummary';

export const listSpeakerProfileUpdateRequests = httpsCallable<
  { cfpId: string },
  {
    ok: true;
    own: ProfileUpdateRequestSummary[];
    admin: ProfileUpdateRequestSummary[];
  }
>(functions, 'listSpeakerProfileUpdateRequests');
