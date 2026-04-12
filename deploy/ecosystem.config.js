// PM2 Configuration — Buchat Server
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'buchat',
      script: './server/src/index.js',
      cwd: '/opt/buchat',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_SECRET: 'CHANGE-THIS-TO-A-SECURE-SECRET',
        REDIS_URL: 'redis://localhost:6379',
        TURN_SERVER: 'turn:YOUR_SERVER_IP:3478',
        TURN_USERNAME: 'buchat',
        TURN_PASSWORD: 'buchat-turn-secret',
      },
    },
  ],
};
