const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const env = { ...process.env, VITE_API_URL: 'https://shelby-backend.onrender.com' };

console.log('Building with VITE_API_URL=', env.VITE_API_URL);
const result = spawnSync('npm.cmd', ['run', 'build'], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});
if (result.error) {
  console.error('Build failed:', result.error);
  process.exit(1);
}
process.exit(result.status);
