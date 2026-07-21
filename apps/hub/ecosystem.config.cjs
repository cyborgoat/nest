/**
 * PM2 process file for Nest Hub (production).
 *
 * Usage (from apps/hub after `npm run build`):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Env vars come from `.env` via Nest ConfigModule (copy `.env.production.example`).
 */
module.exports = {
  apps: [
    {
      name: 'nest-hub',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
