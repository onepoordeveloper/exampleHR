export interface AppConfig {
  port: number;
  databasePath: string;
  hcmBaseUrl: string;
  hcmApiKey: string;
  hcmRequestTimeoutMs: number;
  hcmRetryAttempts: number;
  jwtSecret: string;
  exampleHrBaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databasePath: process.env.DATABASE_PATH ?? './data/timeoff.sqlite',
  hcmBaseUrl: process.env.HCM_BASE_URL ?? 'http://localhost:3001',
  hcmApiKey: process.env.HCM_API_KEY ?? 'dev-secret',
  hcmRequestTimeoutMs: parseInt(
    process.env.HCM_REQUEST_TIMEOUT_MS ?? '5000',
    10,
  ),
  hcmRetryAttempts: parseInt(process.env.HCM_RETRY_ATTEMPTS ?? '3', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret',
  exampleHrBaseUrl: process.env.EXAMPLEHR_BASE_URL ?? 'http://localhost:3000',
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
});
