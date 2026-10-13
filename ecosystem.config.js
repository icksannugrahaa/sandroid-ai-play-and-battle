// PM2 deployment — single instance (the in-memory rate limiter assumes one process).
// Prereqs: PostgreSQL running, Python 3.14, Node.js. See README "Deploy with PM2" and deploy.sh.
module.exports = {
  apps: [
    {
      name: "sandroid-ai-play-and-battle",
      cwd: "./backend", // backend/.env is read from here
      script: ".venv/bin/uvicorn",
      args: "--factory app.main:create_app --host 127.0.0.1 --port 8000 --no-access-log --proxy-headers --forwarded-allow-ips=127.0.0.1",
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      env: { ENVIRONMENT: "production" },
    },
  ],
};
