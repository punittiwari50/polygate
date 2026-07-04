const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

const pathsToDelete = [
  path.join(rootDir, '.pnpm-store'),
  path.join(rootDir, '.pnpm-cache'),
  path.join(rootDir, 'node_modules'),
  path.join(rootDir, 'packages/cli/node_modules'),
  path.join(rootDir, 'packages/cli/dist'),
  path.join(rootDir, 'packages/cli/tsconfig.tsbuildinfo'),
  path.join(rootDir, 'packages/core/node_modules'),
  path.join(rootDir, 'packages/core/dist'),
  path.join(rootDir, 'packages/core/tsconfig.tsbuildinfo'),
  path.join(rootDir, 'packages/gateway-server/node_modules'),
  path.join(rootDir, 'packages/gateway-server/dist'),
  path.join(rootDir, 'packages/gateway-server/tsconfig.tsbuildinfo'),
  path.join(rootDir, 'packages/persistence/node_modules'),
  path.join(rootDir, 'packages/persistence/dist'),
  path.join(rootDir, 'packages/persistence/tsconfig.tsbuildinfo'),
];

console.log('Starting PolyGate Workspace Cleanup...');

let hasErrors = false;

for (const targetPath of pathsToDelete) {
  if (fs.existsSync(targetPath)) {
    try {
      console.log(`Deleting: ${targetPath}`);
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      hasErrors = true;
      console.error(`\x1b[31mError deleting ${targetPath}: ${error.message}\x1b[0m`);
      if (error.code === 'EPERM' || error.code === 'EBUSY') {
        console.error(`\x1b[33mFolder/File is locked. This usually means a process is holding a handle on it.\x1b[0m`);
      }
    }
  }
}

if (hasErrors) {
  console.log('\n\x1b[33mChecking for running Node/TypeScript processes that may be locking folders...\x1b[0m');
  try {
    const stdout = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:LIST', { encoding: 'utf8' });
    if (stdout.trim()) {
      console.log('\x1b[31mFound running Node.js processes:\x1b[0m');
      console.log(stdout);
      console.log('\x1b[33mTo kill these processes, you can run:\x1b[0m');
      console.log('  taskkill /f /im node.exe');
    } else {
      console.log('No running node.exe processes found.');
    }
  } catch (err) {
    // If wmic is not available, try tasklist
    try {
      const stdout = execSync('tasklist /FI "IMAGENAME eq node.exe"', { encoding: 'utf8' });
      console.log(stdout);
    } catch (tasklistErr) {
      console.log('Could not retrieve process list.');
    }
  }
} else {
  console.log('\x1b[32mCleanup completed successfully! All caches, node_modules, and dist folders deleted.\x1b[0m');
}
