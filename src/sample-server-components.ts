/**
 * This is an example of how to setup a local server for testing.  Replace the createRouterConfig function
 * with your own.
 */
import { Logger } from '@bitblit/ratchet/dist/common/logger';
import { ApolloServer, CreateHandlerOptions, gql } from 'apollo-server-lambda';
import { EpsilonRouter } from './http/route/epsilon-router';
import { AuthorizerFunction } from './http/route/authorizer-function';
import { HandlerFunction } from './http/route/handler-function';
import { SimpleRoleRouteAuth } from './http/auth/simple-role-route-auth';
import { BuiltInHandlers } from './http/route/built-in-handlers';
import { ErrorRatchet } from '@bitblit/ratchet/dist/common/error-ratchet';
import { NumberRatchet } from '@bitblit/ratchet/dist/common/number-ratchet';
import { RouterUtil } from './http/route/router-util';
import { EpsilonConstants } from './epsilon-constants';
import { LocalWebTokenManipulator } from './http/auth/local-web-token-manipulator';
import fs from 'fs';
import path from 'path';
import { CommonJwtToken, MapRatchet, PromiseRatchet } from '@bitblit/ratchet/dist/common';
import { HttpConfig } from './http/route/http-config';
import { EpsilonInstance } from './global/epsilon-instance';
import { EpsilonConfigParser } from './epsilon-config-parser';
import { SaltMineConfig } from './salt-mine/salt-mine-config';
import { SaltMineAwsConfig } from './salt-mine/salt-mine-aws-config';
import { SaltMineNamedProcessor } from './salt-mine/salt-mine-named-processor';
import AWS from 'aws-sdk';
import { EchoProcessor } from './salt-mine/built-in/echo-processor';
import { NoOpProcessor } from './salt-mine/built-in/no-op-processor';
import { SampleDelayProcessor } from './salt-mine/built-in/sample-delay-processor';
import { SampleInputValidatedProcessor } from './salt-mine/built-in/sample-input-validated-processor';
import { SimpleLoggedInAuth } from './http/auth/simple-logged-in-auth';

export class SampleServerComponents {
  // Prevent instantiation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static async createSampleApollo(): Promise<ApolloServer> {
    const gqlString: string = SampleServerComponents.loadSampleServerGQL();
    Logger.silly('Creating apollo from : %s', gqlString);
    const typeDefs = gql(gqlString);

    // Provide resolver functions for your schema fields
    const resolvers = {
      RootQueryType: {
        serverMeta: async (root) => {
          return { version: 'A1', serverTime: new Date().toISOString() };
        },
        forceTimeout: async (root) => {
          // This will be longer than the max timeout
          await PromiseRatchet.wait(1000 * 60 * 30);
          return { placeholder: 'A1' };
        },
      },
    };

    const server: ApolloServer = new ApolloServer({
      debug: false,
      typeDefs,
      resolvers,
      context: async ({ event, context }) => {
        const authTokenSt: string =
          !!event && !!event.headers ? MapRatchet.extractValueFromMapIgnoreCase(event.headers, 'authorization') : null;
        const token: CommonJwtToken<any> = null;
        if (!!authTokenSt && authTokenSt.startsWith('Bearer')) {
          Logger.info('Got : %s', authTokenSt);
        }

        const rval: any = {
          user: token,
          headers: event.headers,
          functionName: context.functionName,
          event,
          context,
        };
        return rval;
      },
    });
    return server;
  }

  // Functions below here are for using as samples

  public static async createSampleRouterConfig(): Promise<EpsilonRouter> {
    const yamlString: string = SampleServerComponents.loadSampleOpenApiYaml();
    const authorizers: Map<string, AuthorizerFunction> = new Map<string, AuthorizerFunction>();
    const validTokenAuth: SimpleLoggedInAuth = new SimpleLoggedInAuth();
    authorizers.set('SALTMINE', (token, event, route) => validTokenAuth.handler(token, event, route));

    const handlers: Map<string, HandlerFunction<any>> = new Map<string, HandlerFunction<any>>();
    const simpleRouteAuth: SimpleRoleRouteAuth = new SimpleRoleRouteAuth(['USER'], []);
    authorizers.set('SampleAuthorizer', (token, event, route) => simpleRouteAuth.handler(token, event, route));
    handlers.set('get /', (event, context) => BuiltInHandlers.sample(event, null, context));
    handlers.set('get /meta/server', (event) => BuiltInHandlers.sample(event));
    handlers.set('get /meta/user', (event) => BuiltInHandlers.sample(event));
    handlers.set('get /meta/item/{itemId}', (event) => BuiltInHandlers.sample(event));
    handlers.set('post /secure/access-token', (event) => BuiltInHandlers.sample(event));

    handlers.set('get /multi/fixed', (event) => BuiltInHandlers.sample(event, 'fixed'));
    handlers.set('get /multi/{v}', (event) => BuiltInHandlers.sample(event, 'variable'));
    handlers.set('get /err/{code}', (event) => {
      const err: Error = ErrorRatchet.fErr('Fake Err : %j', event);
      err['statusCode'] = NumberRatchet.safeNumber(event.pathParameters['code']);
      throw err;
    });
    handlers.set('get /meta/simple-item', (event) => {
      const numberToUse: number = NumberRatchet.safeNumber(event.queryStringParameters['num']) || 5;
      const rval: any = {
        numberField: numberToUse,
        stringField: 'Test-String',
      };
      return rval;
    });

    // Unused - intercepted by Epsilon, but needed to prevent 404
    handlers.set('get /graphql', (evt) => BuiltInHandlers.handleNotImplemented(evt));
    handlers.set('post /graphql', (evt) => BuiltInHandlers.handleNotImplemented(evt));

    const cfg: HttpConfig = {
      handlers: handlers,
      authorizers: authorizers,
      corsAllowedHeaders: EpsilonConstants.CORS_MATCH_REQUEST_FLAG,
      corsAllowedOrigins: EpsilonConstants.CORS_MATCH_REQUEST_FLAG,
      corsAllowedMethods: EpsilonConstants.CORS_MATCH_REQUEST_FLAG,
      requestIdResponseHeaderName: 'X-REQUEST-ID',
      defaultErrorMessage: 'Internal Server Error',
      defaultTimeoutMS: 10_000,

      webTokenManipulator: new LocalWebTokenManipulator('abcd1234', 'Epsilon-Sample-Server', 'info'),

      apolloServer: await SampleServerComponents.createSampleApollo(),
      apolloCreateHandlerOptions: {
        cors: {
          origin: '*',
          credentials: true,
        },
      },
      apolloRegex: new RegExp('.*graphql.*'),
      saltMineSubmissionHandlerPath: '/background',
      // saltMineSubmissionAuthorizerName: 'SALTMINE'
    };

    const saltMine: SaltMineConfig = {
      aws: {
        queueUrl: 'FAKE-LOCAL',
        notificationArn: 'FAKE-LOCAL',
        sqs: {} as AWS.SQS,
        sns: {} as AWS.SNS,
      },
      processors: [new EchoProcessor(), new NoOpProcessor(), new SampleDelayProcessor(), new SampleInputValidatedProcessor()],
    };

    const epsilonInstance: EpsilonInstance = EpsilonConfigParser.epsilonConfigToEpsilonInstance(
      {
        openApiYamlString: yamlString,
        httpConfig: cfg,
        saltMineConfig: saltMine,
      },
      true
    );

    const router: EpsilonRouter = epsilonInstance.epsilonRouter;
    // Modify a single route...
    RouterUtil.findRoute(router, 'get', '/meta/server').allowLiteralStringNullAsQueryStringParameter = true;

    return router;
  }

  public static loadSampleOpenApiYaml(): string {
    const yamlString: string = fs.readFileSync(path.join(__dirname, 'static', 'sample-open-api-doc.yaml')).toString();
    return yamlString;
  }

  public static loadSampleServerGQL(): string {
    const yamlString: string = fs.readFileSync(path.join(__dirname, 'static', 'sample-server.gql')).toString();
    return yamlString;
  }
}
