/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as firestore from '@firebase/firestore-types';

import {
  CredentialChangeListener,
  CredentialsProvider,
  EmptyCredentialsProvider
} from '../../../src/api/credentials';
import { Firestore } from '../../../src/api/database';
import { User } from '../../../src/auth/user';
import { DatabaseId, DatabaseInfo } from '../../../src/core/database_info';
import { newConnection } from '../../../src/platform/connection';
import { newSerializer } from '../../../src/platform/serializer';
import { newDatastore, Datastore } from '../../../src/remote/datastore';
import { AsyncQueue } from '../../../src/util/async_queue';
import { AsyncQueueImpl } from '../../../src/util/async_queue_impl';
import { TestBundleBuilder } from '../../unit/util/bundle_data';
import { collectionReference } from '../../util/api_helpers';
import { key } from '../../util/helpers';

import { withTestDbsSettings } from './helpers';
import { DEFAULT_PROJECT_ID, DEFAULT_SETTINGS } from './settings';

export function asyncQueue(db: firestore.FirebaseFirestore): AsyncQueueImpl {
  return (db as Firestore)._delegate._queue as AsyncQueueImpl;
}

export function getDefaultDatabaseInfo(): DatabaseInfo {
  return new DatabaseInfo(
    new DatabaseId(DEFAULT_PROJECT_ID),
    'test-app-id',
    'persistenceKey',
    DEFAULT_SETTINGS.host!,
    !!DEFAULT_SETTINGS.ssl,
    !!DEFAULT_SETTINGS.experimentalForceLongPolling,
    !!DEFAULT_SETTINGS.experimentalAutoDetectLongPolling,
    /*use FetchStreams= */ false
  );
}

export function withTestDatastore(
  fn: (datastore: Datastore) => Promise<void>,
  credentialsProvider: CredentialsProvider = new EmptyCredentialsProvider()
): Promise<void> {
  const databaseInfo = getDefaultDatabaseInfo();
  const connection = newConnection(databaseInfo);
  const serializer = newSerializer(databaseInfo.databaseId);
  const datastore = newDatastore(credentialsProvider, connection, serializer);
  return fn(datastore);
}

export class MockCredentialsProvider extends EmptyCredentialsProvider {
  private listener: CredentialChangeListener | null = null;
  private asyncQueue: AsyncQueue | null = null;

  triggerUserChange(newUser: User): void {
    this.asyncQueue!.enqueueRetryable(async () => this.listener!(newUser));
  }

  setChangeListener(
    asyncQueue: AsyncQueue,
    listener: CredentialChangeListener
  ): void {
    super.setChangeListener(asyncQueue, listener);
    this.asyncQueue = asyncQueue;
    this.listener = listener;
  }
}

export function withMockCredentialProviderTestDb(
  persistence: boolean,
  fn: (
    db: firestore.FirebaseFirestore,
    mockCredential: MockCredentialsProvider
  ) => Promise<void>
): Promise<void> {
  const mockCredentialsProvider = new MockCredentialsProvider();
  const settings = {
    ...DEFAULT_SETTINGS,
    credentials: { client: mockCredentialsProvider, type: 'provider' }
  };
  return withTestDbsSettings(
    persistence,
    DEFAULT_PROJECT_ID,
    settings,
    1,
    ([db]) => {
      return fn(db, mockCredentialsProvider);
    }
  );
}

/**
 * Returns a testing bundle string for the given projectId.
 *
 * The function is not referenced by bundle.test.ts, instead the bundle string used there
 * is generated by this function and copied over there. The reason is this function accesses
 * SDK internals, which is not available in test:minified.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function bundleWithTestDocsAndQueries(
  projectId: string = 'test-project'
): string {
  const testDocs: { [key: string]: firestore.DocumentData } = {
    a: { k: { stringValue: 'a' }, bar: { integerValue: 1 } },
    b: { k: { stringValue: 'b' }, bar: { integerValue: 2 } }
  };

  const a = key('coll-1/a');
  const b = key('coll-1/b');
  const builder = new TestBundleBuilder(new DatabaseId(projectId));

  builder.addNamedQuery(
    'limit',
    { seconds: 1000, nanos: 9999 },
    (collectionReference('coll-1')
      .orderBy('bar', 'desc')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .limit(1) as any)._query
  );
  builder.addNamedQuery(
    'limit-to-last',
    { seconds: 1000, nanos: 9999 },
    (collectionReference('coll-1')
      .orderBy('bar', 'desc')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .limitToLast(1) as any)._query
  );

  builder.addDocumentMetadata(a, { seconds: 1000, nanos: 9999 }, true);
  builder.addDocument(
    a,
    { seconds: 1, nanos: 9 },
    { seconds: 1, nanos: 9 },
    testDocs.a
  );
  builder.addDocumentMetadata(b, { seconds: 1000, nanos: 9999 }, true);
  builder.addDocument(
    b,
    { seconds: 1, nanos: 9 },
    { seconds: 1, nanos: 9 },
    testDocs.b
  );

  return builder
    .build('test-bundle', { seconds: 1001, nanos: 9999 })
    .toString();
}
