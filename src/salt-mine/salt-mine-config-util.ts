import { SaltMineConfig } from './salt-mine-config';
import { ErrorRatchet, Logger, StringRatchet } from '@bitblit/ratchet/dist/common';
import { ModelValidator } from '../http/route/model-validator';
import { SaltMineNamedProcessor } from './salt-mine-named-processor';

export class SaltMineConfigUtil {
  // Prevent instantiation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static processNames(cfg: SaltMineConfig): string[] {
    return cfg && cfg.processors ? cfg.processors.map((p) => p.typeName) : null;
  }

  public static awsConfig(cfg: SaltMineConfig): boolean {
    return !!cfg && !!cfg.aws;
  }

  public static validateAndMapProcessors(
    processorInput: SaltMineNamedProcessor<any, any>[],
    modelValidator: ModelValidator
  ): Map<string, SaltMineNamedProcessor<any, any>> {
    const rval: Map<string, SaltMineNamedProcessor<any, any>> = new Map<string, SaltMineNamedProcessor<any, any>>();
    processorInput.forEach((p, idx) => {
      if (!p) {
        ErrorRatchet.throwFormattedErr('Null processor provided at index %d', idx);
      }
      if (!StringRatchet.trimToNull(p.typeName)) {
        ErrorRatchet.throwFormattedErr('Processor at index %d defines no name', idx);
      }

      if (rval.has(p.typeName)) {
        ErrorRatchet.throwFormattedErr('More than one processor defined for type %s', p.typeName);
      }
      if (StringRatchet.trimToNull(p.dataSchema)) {
        if (!modelValidator) {
          ErrorRatchet.throwFormattedErr('%s defines a data schema but model validator not set', p.typeName);
        }
        if (!modelValidator.fetchModel(p.dataSchema)) {
          ErrorRatchet.throwFormattedErr('%s defines a data schema %s but model validator does not contain it', p.typeName, p.dataSchema);
        }
        if (p.dataSchema && p.validateData) {
          ErrorRatchet.throwFormattedErr('%s defines a data schema %s and also a validation function', p.typeName, p.dataSchema);
        }
      }

      if (StringRatchet.trimToNull(p.metaDataSchema)) {
        if (!modelValidator) {
          ErrorRatchet.throwFormattedErr('%s defines a metaData schema but model validator not set', p.typeName);
        }
        if (!modelValidator.fetchModel(p.metaDataSchema)) {
          ErrorRatchet.throwFormattedErr(
            '%s defines a metaData schema %s but model validator does not contain it',
            p.typeName,
            p.metaDataSchema
          );
        }
        if (p.metaDataSchema && p.validateMetaData) {
          ErrorRatchet.throwFormattedErr('%s defines a metaData schema %s and also a validation function', p.typeName, p.metaDataSchema);
        }
      }

      rval.set(p.typeName, p);
    });
    return rval;
  }

  public static validateConfig(cfg: SaltMineConfig): string[] {
    const rval: string[] = [];
    if (!cfg) {
      rval.push('Null config');
    } else {
      if (!cfg.processors || cfg.processors.length === 0) {
        rval.push('No processes specified');
      }
      if (!cfg.aws) {
        rval.push('AWS config not defined');
      } else {
        if (!cfg.aws.notificationArn) {
          rval.push('AWS config missing notificationArn');
        }
        if (!cfg.aws.queueUrl) {
          rval.push('AWS config missing queueUrl');
        }
        if (!cfg.aws.sns) {
          rval.push('AWS config missing sns');
        }
        if (!cfg.aws.sqs) {
          rval.push('AWS config missing sqs');
        }
      }
    }
    return rval;
  }
}