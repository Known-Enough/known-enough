# KE13 connected site: operator-only CLI handoff

This is the **regular authenticated app** site for KE13. It is separate from the deployed Stage 0 mock bucket and distribution. The commands below are unexecuted. User A runs them only after KE13B's independent focused review passes and the user authorizes the exact Stage 1 resource, permission and cost scope. Keep generated JSON and CLI outputs outside the repository. Use only synthetic staging accounts. These steps follow the [AWS CloudFront CLI OAC walkthrough](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/get-started-cli-tutorial.html) and [S3 OAC policy guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

## Provision a separate private HTTPS origin

The approved setup profile needs `sts:GetCallerIdentity`; one new bucket's `s3:CreateBucket`, `PutBucketPublicAccessBlock`, `PutBucketOwnershipControls`, `PutEncryptionConfiguration`, `PutBucketVersioning`, `PutLifecycleConfiguration`, `GetBucketPolicy`, `PutBucketPolicy`, and upload/read actions; plus `cloudfront:CreateOriginAccessControl`, `CreateDistribution`, `GetDistribution`, `CreateInvalidation` for the new OAC/distribution. Creation actions can require separately reviewed setup permissions before exact ARNs exist. The policy installer must be a separately trusted profile allowed to update only the new bucket policy; the existing Stage 0 release role is not suitable. Record the approved profile and permission diff. Do not change any Stage 0 resource.

Use an available globally unique bucket name after an ownership/availability check. Fill the placeholders from the approved scope and an explicit STS result; stop on missing, mismatched or `None` output. For `us-east-1`, `create-bucket` omits a location constraint. The following setup commands are **cloud-changing** and belong only to User A:

```bash
export KE13_SITE_PROFILE=REPLACE_APPROVED_SITE_SETUP_PROFILE
export KE13_SITE_POLICY_PROFILE=REPLACE_APPROVED_TRUSTED_POLICY_PROFILE
export KE13_SITE_REGION=us-east-1
export KE13_SITE_ACCOUNT=REPLACE_VERIFIED_ACCOUNT_ID
export KE13_SITE_BUCKET=REPLACE_UNIQUE_CONNECTED_SITE_BUCKET
export KE13_SITE_DIR=/tmp/known-enough-ke13-site
mkdir -p "$KE13_SITE_DIR"
aws sts get-caller-identity --profile "$KE13_SITE_PROFILE" --query '{Account:Account,Arn:Arn}'
# Stop unless Account equals KE13_SITE_ACCOUNT and the role matches the approved setup scope.
aws s3api create-bucket --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" --bucket "$KE13_SITE_BUCKET"
aws s3api put-public-access-block --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --lifecycle-configuration '{"Rules":[{"ID":"ExpireOldConnectedBuilds","Status":"Enabled","Filter":{"Prefix":""},"NoncurrentVersionExpiration":{"NoncurrentDays":14}}]}'
aws cloudfront create-origin-access-control --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --origin-access-control-config Name=known-enough-ke13-connected,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 \
  --query 'OriginAccessControl.Id' --output text
export KE13_SITE_OAC_ID=REPLACE_OAC_ID_FROM_PREVIOUS_OUTPUT
```

Render the distribution configuration locally using the **exact** bucket and OAC ID returned above. Review the JSON and SHA-256 before creating the distribution. The S3 origin is not a website endpoint; CloudFront signs every origin request. The default root serves the OAuth callback/logout page at `/`. Only GET/HEAD are allowed from viewers. The default CloudFront hostname provides HTTPS without a custom domain, certificate or Route 53 record.

```bash
export KE13_SITE_BUCKET KE13_SITE_OAC_ID KE13_SITE_DIR
python3 - <<'PY'
import json, os, re, uuid
from pathlib import Path
bucket=os.environ['KE13_SITE_BUCKET']; oac=os.environ['KE13_SITE_OAC_ID']
assert re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket)
assert re.fullmatch(r'[A-Z0-9]{8,32}', oac)
origin='S3-'+bucket
config={
  'CallerReference':'known-enough-ke13-'+str(uuid.uuid4()),
  'Origins':{'Quantity':1,'Items':[{'Id':origin,'DomainName':bucket+'.s3.us-east-1.amazonaws.com',
    'S3OriginConfig':{'OriginAccessIdentity':''},'OriginAccessControlId':oac}]},
  'DefaultCacheBehavior':{'TargetOriginId':origin,'ViewerProtocolPolicy':'redirect-to-https',
    'AllowedMethods':{'Quantity':2,'Items':['GET','HEAD'],
      'CachedMethods':{'Quantity':2,'Items':['GET','HEAD']}},
    'MinTTL':0,'DefaultTTL':86400,'MaxTTL':31536000,'Compress':True,
    'ForwardedValues':{'QueryString':False,'Cookies':{'Forward':'none'}}},
  'DefaultRootObject':'index.html','Comment':'Known Enough KE13 connected staging site',
  'PriceClass':'PriceClass_100','ViewerCertificate':{'CloudFrontDefaultCertificate':True},
  'Restrictions':{'GeoRestriction':{'RestrictionType':'none','Quantity':0}},
  'IsIPV6Enabled':True,'Enabled':True,
}
Path(os.environ['KE13_SITE_DIR'],'distribution.json').write_text(json.dumps(config,indent=2)+'\n')
PY
sha256sum "$KE13_SITE_DIR/distribution.json"
aws cloudfront create-distribution --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --distribution-config "file://$KE13_SITE_DIR/distribution.json" \
  --query 'Distribution.{Id:Id,DomainName:DomainName,Status:Status}'
export KE13_SITE_DISTRIBUTION_ID=REPLACE_DISTRIBUTION_ID_FROM_PREVIOUS_OUTPUT
export KE13_SITE_DOMAIN=REPLACE_DOMAIN_NAME_FROM_PREVIOUS_OUTPUT
export KE13_SITE_ORIGIN="https://$KE13_SITE_DOMAIN"
```

The trusted policy installer independently verifies the new bucket ownership, account, distribution ID and OAC attachment before writing the exact policy. It must read the policy back and compare it with the reviewed local file. Do not use an account-wide public principal, website hosting or `s3:*` on the bucket.

```bash
aws sts get-caller-identity --profile "$KE13_SITE_POLICY_PROFILE" --query '{Account:Account,Arn:Arn}'
aws cloudfront get-distribution --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --id "$KE13_SITE_DISTRIBUTION_ID" \
  --query 'Distribution.{ARN:ARN,Domain:DomainName,Origins:DistributionConfig.Origins.Items}'
export KE13_SITE_ACCOUNT KE13_SITE_BUCKET KE13_SITE_DISTRIBUTION_ID KE13_SITE_DIR
python3 - <<'PY'
import json, os, re
from pathlib import Path
account=os.environ['KE13_SITE_ACCOUNT']; bucket=os.environ['KE13_SITE_BUCKET']; dist=os.environ['KE13_SITE_DISTRIBUTION_ID']
assert re.fullmatch(r'\d{12}',account)
assert re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',bucket)
assert re.fullmatch(r'[A-Z0-9]{8,32}',dist)
policy={'Version':'2012-10-17','Statement':[{'Sid':'AllowExactConnectedCloudFrontRead',
  'Effect':'Allow','Principal':{'Service':'cloudfront.amazonaws.com'},'Action':'s3:GetObject',
  'Resource':f'arn:aws:s3:::{bucket}/*',
  'Condition':{'StringEquals':{'AWS:SourceArn':f'arn:aws:cloudfront::{account}:distribution/{dist}'}}}]}
Path(os.environ['KE13_SITE_DIR'],'bucket-policy.json').write_text(json.dumps(policy,indent=2)+'\n')
PY
sha256sum "$KE13_SITE_DIR/bucket-policy.json"
aws s3api put-bucket-policy --profile "$KE13_SITE_POLICY_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" \
  --policy "file://$KE13_SITE_DIR/bucket-policy.json"
aws s3api get-bucket-policy --profile "$KE13_SITE_POLICY_PROFILE" --region "$KE13_SITE_REGION" \
  --bucket "$KE13_SITE_BUCKET" --expected-bucket-owner "$KE13_SITE_ACCOUNT" --query Policy --output text
aws cloudfront wait distribution-deployed --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --id "$KE13_SITE_DISTRIBUTION_ID"
```

## Build and release the connected app after the API exists

Use the **six public configuration values** from the verified KE11 pool/client and KE13B API outputs. The browser contains public app-client IDs only; never include AWS credentials, access tokens, passwords, subject mappings or private inputs. Use a clean reviewed commit and pinned Node/npm. Build the regular app, run its scanner, confirm the output has no local test identity or owner-demo chunks, and record file hashes. Do not upload `dist-hosted-preview` or overwrite the Stage 0 site.

```bash
export VITE_COGNITO_REGION="$KE13B_REGION"
export VITE_COGNITO_USER_POOL_ID="$KE11_POOL_ID"
export VITE_COGNITO_DOMAIN="https://${KE11_DOMAIN_PREFIX}.auth.${KE13B_REGION}.amazoncognito.com"
export VITE_COGNITO_PARTICIPANT_CLIENT_ID="$KE11_PARTICIPANT_CLIENT_ID"
export VITE_COGNITO_DISPLAY_CLIENT_ID="$KE11_DISPLAY_CLIENT_ID"
export VITE_API_BASE_URL="$KE13B_API_BASE_URL"
PATH="$PWD/node_modules/.cache/ke10-tools/bin:$PATH" npm run build --workspace @deal-table/web
node scripts/check-bundle.mjs
sha256sum apps/web/dist/index.html apps/web/dist/assets/*
aws s3 cp apps/web/dist/index.html "s3://$KE13_SITE_BUCKET/index.html" \
  --content-type text/html --cache-control no-cache --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION"
aws s3 cp apps/web/dist/assets/ "s3://$KE13_SITE_BUCKET/assets/" --recursive \
  --cache-control 'public,max-age=31536000,immutable' --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION"
aws cloudfront create-invalidation --profile "$KE13_SITE_PROFILE" --region "$KE13_SITE_REGION" \
  --distribution-id "$KE13_SITE_DISTRIBUTION_ID" --paths / /index.html '/assets/*'
```

Wait for the invalidation and confirm HTTPS `/` and the referenced assets return 200 with the expected hashes. Register the exact `$KE13_SITE_ORIGIN/` as both Cognito callback and logout URL. Before first sign-in, confirm that the app origin equals the Lambda's `KE13B_ALLOWED_ORIGIN`, the browser's API URL equals the deployed API endpoint, and no local test picker appears. An unauthenticated API call must return 401. The [KE13B backend runbook](staging-runbook.md#ke13b-authenticated-backend-handoff-for-ke13-not-executed) and [KE13 ticket](../docs/tasks/KE13.md) own the subsequent live probes and evidence. Record actual account, role, region, bucket/OAC/distribution IDs, origin, build hashes, policy hash, status, observed cost and cleanup date in the private operations handoff. CloudFront/S3 deletion requires a separately authorized cleanup with distribution disable/wait, object-version removal and exact resource-ID checks; the staging runbook has the retained cleanup sequence.
