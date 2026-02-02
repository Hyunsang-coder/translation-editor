/**
 * Web Platform Adapter
 *
 * IndexedDB와 Web API를 사용한 웹 버전 어댑터입니다.
 */

import type { PlatformAdapter } from '../types';
import { webStorageAdapter } from './storage';
import { webSecretsAdapter } from './secrets';
import { webDialogAdapter } from './dialog';
import { webAttachmentsAdapter } from './attachments';
import { webAiAdapter } from './ai';

export const webAdapter: PlatformAdapter = {
  type: 'web',
  storage: webStorageAdapter,
  secrets: webSecretsAdapter,
  dialog: webDialogAdapter,
  attachments: webAttachmentsAdapter,
  ai: webAiAdapter,
};
