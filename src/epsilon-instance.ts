import { EpsilonConfig } from './config/epsilon-config';
import { WebHandler } from './http/web-handler';
import { BackgroundHandler } from './background/background-handler';
import { OpenApiDocument } from './config/open-api/open-api-document';
import { ModelValidator } from '@bitblit/ratchet/dist/model-validator';
import { BackgroundManager } from './background-manager';
import { InterApiManager } from './inter-api-manager';

/**
 * This interface just wraps up everything that gets created by the config parsing process so that
 * I can hand it in a neat package to EpsilonGlobalHandler, rather than passing in a bunch of
 * params on the constructor
 */
export interface EpsilonInstance {
  config: EpsilonConfig;
  parsedOpenApiDoc: OpenApiDocument;
  modelValidator: ModelValidator;
  webHandler: WebHandler;
  backgroundHandler: BackgroundHandler;
  backgroundManager: BackgroundManager;
}
