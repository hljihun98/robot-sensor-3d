module.exports = {
  apps: [{
    name: 'sensorlog',
    script: 'server/app.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: 3210, COOKIE_SECURE: 'true', TRUST_PROXY: '1' }
  }]
};
