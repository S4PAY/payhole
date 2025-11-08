import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const schemaPath = path.resolve(
  __dirname,
  '../../../ai/pkg/schema/telemetry_event.schema.json',
);

let validator: ValidateFunction | null = null;

export type TelemetryPublisherOptions = {
  source: 'payments' | 'proxy' | 'edge';
  policyVersion: string;
  logPath: string;
};

export type TelemetryRecord = {
  domain: string;
  reason: string;
  timestamp: string;
  riskScore?: number;
  userAgent?: string;
  clientIp?: string;
  userId?: string;
};

function loadValidator(): ValidateFunction {
  if (validator) {
    return validator;
  }
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const schemaRaw = require(schemaPath);
  validator = ajv.compile(schemaRaw);
  return validator;
}

function hashUserId(userId?: string): string | undefined {
  if (!userId) {
    return undefined;
  }
  return createHash('sha256').update(userId).digest('base64');
}

export class TelemetryPublisher {
  private readonly options: TelemetryPublisherOptions;
  private readonly validate: ValidateFunction;

  constructor(options: TelemetryPublisherOptions) {
    this.options = options;
    this.validate = loadValidator();
  }

  async publish(record: TelemetryRecord): Promise<void> {
    const payload = {
      id: randomUUID(),
      domain: record.domain,
      reason: record.reason,
      source: this.options.source,
      policyVersion: this.options.policyVersion,
      riskScore: typeof record.riskScore === 'number' ? record.riskScore : 0,
      hashedUserId: hashUserId(record.userId),
      clientIp: record.clientIp,
      userAgent: record.userAgent,
      timestamp: record.timestamp,
    };

    const valid = this.validate(payload);
    if (!valid) {
      const err = new Error(`invalid telemetry payload: ${this.validate.errors?.[0]?.message ?? 'unknown'}`);
      throw err;
    }

    await this.append(JSON.stringify(payload));
  }

  private async append(line: string): Promise<void> {
    const dir = path.dirname(this.options.logPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(this.options.logPath, line + '\n');
  }
}
