import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import type { EnvConfig } from './env-config'

export interface BookcheckAgentStackProps extends StackProps {
  config: EnvConfig
}

// Everything the enhanced application needs in AWS:
//   - the single DynamoDB table
//   - a managed policy granting exactly the table access we use
//
// The book's own resources (AgentCore runtime, Amplify app,
// Cognito) are created by the hands-on. This stack only adds
// what the delta needs, so it can be deployed and destroyed
// without touching them.
export class BookcheckAgentStack extends Stack {
  readonly table: dynamodb.Table
  readonly accessPolicy: iam.ManagedPolicy

  constructor(scope: Construct, id: string, props: BookcheckAgentStackProps) {
    super(scope, id, props)

    const { config } = props

    this.table = new dynamodb.Table(this, 'AppTable', {
      tableName: config.tableName,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: config.removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
      },
      // Items may carry an `expiresAt` epoch second. Sessions and
      // messages set it; the rate bucket does not, so it survives.
      timeToLiveAttribute: 'expiresAt',
    })

    // Least privilege: only the actions the Route Handlers call.
    this.accessPolicy = new iam.ManagedPolicy(this, 'TableAccessPolicy', {
      managedPolicyName: `bookcheck-agent-table-${config.name}`,
      description: `DynamoDB access for bookcheck-agent (${config.name})`,
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:BatchWriteItem',
          ],
          resources: [this.table.tableArn],
        }),
      ],
    })

    // If you already created the Amplify SSR compute role in the
    // hands-on (13.4.7), pass its name and the policy is attached
    // for you. Otherwise attach it by hand in the IAM console.
    if (config.ssrRoleName) {
      const ssrRole = iam.Role.fromRoleName(this, 'SsrRole', config.ssrRoleName)
      ssrRole.addManagedPolicy(this.accessPolicy)
    }

    const tableNameOutput = new CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'Set this as DYNAMO_TABLE_NAME',
    })
    const tableAccessPolicyArnOutput = new CfnOutput(this, 'TableAccessPolicyArn', {
      value: this.accessPolicy.managedPolicyArn,
      description: 'Attach this to the Amplify SSR compute role',
    })

    void tableNameOutput
    void tableAccessPolicyArnOutput
  }
}
