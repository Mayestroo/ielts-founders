module.exports = {
  apps: [{
    name: 'api',
    script: 'dist/src/main.js',
    instances: 6,
    exec_mode: 'cluster',
    max_memory_restart: '1200M',
    restart_delay: 1000,
    max_restarts: 10,
    listen_timeout: 8000,
    kill_timeout: 5000,
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      UV_THREADPOOL_SIZE: 6
    }
  }]
};
