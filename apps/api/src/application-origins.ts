const PRIMARY_ORIGIN = 'https://main.d143q5ravxp5av.amplifyapp.com';
const VERCEL_ORIGIN = 'https://known-enough.vercel.app';

/** Two owned production addresses share one API. Other deployments retain their exact configured origin. */
export function applicationOrigins(configuredOrigin: string): readonly string[] {
  return configuredOrigin === PRIMARY_ORIGIN || configuredOrigin === VERCEL_ORIGIN
    ? [PRIMARY_ORIGIN, VERCEL_ORIGIN]
    : [configuredOrigin];
}
