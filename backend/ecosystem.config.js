module.exports = {
  apps: [
    {
      name: 'ielts-backend',
      script: 'dist/src/main.js',
      instances: 2, // run 2 instances for high availability
      exec_mode: 'cluster',
      max_memory_restart: '1G', // Restart if memory exceeds 1GB
      node_args: '--max-old-space-size=1024', // Optimize GC for 1GB heap
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 5000,
      // Auto-restart
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
  ],
};
