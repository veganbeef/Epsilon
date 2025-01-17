/**
 * This is an example of how to setup a local server for testing.  Replace the createRouterConfig function
 * with your own.
 */
import { Logger } from '@bitblit/ratchet/dist/common/logger';
import { SampleServerComponents } from './sample-server-components';
import { LocalServer } from '../local-server';

Logger.setLevelByName('debug');

SampleServerComponents.createSampleBatchOnlyEpsilonGlobalHandler()
  .then((handler) => {
    const testServer: LocalServer = new LocalServer(handler);
    testServer.runServer().then((res) => {
      Logger.info('Got res server');
      process.exit(0);
    });
  })
  .catch((err) => {
    Logger.error('Error: %s', err, err);
    process.exit(1);
  });
