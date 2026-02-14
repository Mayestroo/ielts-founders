module.exports = {
  apps: [
    {
      name: 'ielts-api',
      cwd: '/srv/ielts/current/backend',
      script: 'dist/src/main.js',
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '700M',
      env_file: '/srv/ielts/env/backend.env',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        DISABLE_WRITING_QUEUE_WORKER: 'true',
      },
    },
    {
      name: 'ielts-worker',
      cwd: '/srv/ielts/current/backend',
      script: 'dist/src/worker.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      env_file: '/srv/ielts/env/backend.env',
      env: {
        NODE_ENV: 'production',
        DISABLE_WRITING_QUEUE_WORKER: 'false',
      },
    },
    {
      name: 'ielts-web',
      cwd: '/srv/ielts/current/frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001 -H 127.0.0.1',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '600M',
      env_file: '/srv/ielts/env/frontend.env',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ielts-admin',
      cwd: '/srv/ielts/current/admin-panel',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002 -H 127.0.0.1',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '600M',
      env_file: '/srv/ielts/env/admin.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
