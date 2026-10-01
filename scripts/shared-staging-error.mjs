// Emit only fixed service codes and the already-public target resource.
// Raw AWS errors may include principal names, request bodies or credentials.
const knownCodes = new Set([
  'AccessDenied', 'AccessDeniedException', 'UnauthorizedException',
  'ResourceNotFoundException', 'ThrottlingException', 'ExpiredTokenException',
  'InvalidClientTokenId', 'UnrecognizedClientException', 'ValidationException',
]);
const amplifyAppArn = 'arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av';
const knownResources = [
  amplifyAppArn,
  `${amplifyAppArn}/branches/main`,
  `${amplifyAppArn}/branches/main/jobs/*`,
];

export function safeAwsFailureDetail(stderr) {
  const text = String(stderr ?? '');
  const code = text.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1];
  const parts = knownCodes.has(code) ? [`code=${code}`] : [];
  const resource = text.match(/(?:on )?resource:?\s*["']?(arn:[^\s"',;]+)/i)?.[1];
  if (knownResources.includes(resource)) parts.push(`resource=${resource}`);
  if (/because no identity-based policy allows/i.test(text)) parts.push('reason=no identity-based allow');
  else if (/explicit deny in a service control policy/i.test(text)) parts.push('reason=service control policy deny');
  else if (/explicit deny in a permissions boundary/i.test(text)) parts.push('reason=permissions boundary deny');
  return parts.length ? ` (${parts.join('; ')})` : '';
}
