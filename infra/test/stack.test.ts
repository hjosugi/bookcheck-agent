import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { BookcheckAgentStack } from '../lib/bookcheck-agent-stack';
import { ENVIRONMENTS, resolveEnv } from '../lib/env-config';

function synth(envName: 'dev' | 'prod', ssrRoleName?: string) {
  const app = new App();
  const config = { ...ENVIRONMENTS[envName], ssrRoleName };
  const stack = new BookcheckAgentStack(app, `Test-${envName}`, {
    config,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('env config', () => {
  it('rejects an unknown environment name', () => {
    expect(() => resolveEnv('staging')).toThrow(/dev.*prod/);
  });

  it('gives dev and prod different table names', () => {
    expect(ENVIRONMENTS.dev.tableName).not.toBe(ENVIRONMENTS.prod.tableName);
  });
});

describe('table', () => {
  it('creates one on-demand table with the composite key', () => {
    const t = synth('dev');
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('protects prod data and not dev data', () => {
    synth('prod').hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      }),
    });
    synth('dev').hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
    });
  });
});

describe('iam policy', () => {
  it('grants only the six actions the handlers use', () => {
    const t = synth('dev');
    t.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:BatchWriteItem',
            ],
          }),
        ],
      }),
    });
  });

  it('never grants a wildcard action', () => {
    const policies = synth('prod').findResources('AWS::IAM::ManagedPolicy');
    const actions = Object.values(policies).flatMap((p) =>
      p.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) =>
        Array.isArray(s.Action) ? s.Action : [s.Action],
      ),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).not.toContain('*');
    }
  });

  it('attaches to the SSR role only when a role name is given', () => {
    const without = synth('dev');
    const policies = Object.values(without.findResources('AWS::IAM::ManagedPolicy'));
    expect(policies).toHaveLength(1);
    expect(policies[0].Properties.Roles).toBeUndefined();

    const withRole = synth('dev', 'bookchecker-ssr-role');
    withRole.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      Roles: ['bookchecker-ssr-role'],
    });
  });
});

describe('outputs', () => {
  it('exports the table name and the policy arn', () => {
    const outputs = synth('prod').toJSON().Outputs as Record<string, unknown>;
    const keys = Object.keys(outputs);
    expect(keys).toContain('TableName');
    expect(keys).toContain('TableAccessPolicyArn');
  });
});
