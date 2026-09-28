import { createAuthorizedBedrockTransport, BEDROCK_CONFIGURATION } from '@deal-table/adapters';
import { Ke10EvaluationFailure, runKe10Evaluations } from './ke10.ts';

// Deliberately no default credentials inspection or calls. Operator approval is external evidence.
if (process.env.KE10_PAID_SMOKE_APPROVED !== 'yes'
  || process.env.KE10_INVOCATION_LOGGING_DISABLED !== 'yes'
  || process.env.KE10_RETENTION_REVIEWED !== 'yes') {
  process.stderr.write('KE10_LIVE_NOT_AUTHORIZED\n');
  process.exitCode = 2;
} else {
  try {
    const result = await runKe10Evaluations(createAuthorizedBedrockTransport({
      paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true,
    }));
    process.stdout.write(JSON.stringify({ mode: 'LIVE', ...result }) + '\n');
  } catch (error) {
    const diagnostic = error instanceof Ke10EvaluationFailure
      ? { stage: error.stage, failureCode: error.failureCode } : { stage: 'setup', failureCode: 'UNEXPECTED_FAILURE' };
    process.stderr.write(JSON.stringify({ mode: 'LIVE', configuration: BEDROCK_CONFIGURATION,
      outcome: 'EVALUATION_FAILED', ...diagnostic }) + '\n');
    process.exitCode = 1;
  }
}
