import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { ConverseTransport } from '../../packages/adapters/src/bedrock-models.ts';
export function budgetedTransport(transport: ConverseTransport, client: DynamoDBClient, table: string, now?: () => number): ConverseTransport;
