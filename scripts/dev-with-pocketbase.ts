import { execa } from 'execa';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory of this script file
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const projectRoot = resolve(__dirname, '..');

async function startDevWithPocketBase() {
  console.log('Starting development environment with PocketBase...');
  
  try {
    // Start PocketBase server in the background
    const pocketbaseProcess = execa('pnpm', ['pocketbase:start'], {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    
    // Wait a bit for PocketBase to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start the SolidStart app
    const appProcess = execa('pnpm', ['start:dev'], {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    
    // Handle process termination
    const handleTermination = () => {
      console.log('\nShutting down development environment...');
      pocketbaseProcess.kill();
      appProcess.kill();
      process.exit(0);
    };
    
    process.on('SIGINT', handleTermination);
    process.on('SIGTERM', handleTermination);
    
    // Wait for both processes to complete (they shouldn't unless there's an error)
    await Promise.allSettled([
      pocketbaseProcess,
      appProcess
    ]);
    
  } catch (error) {
    console.error('Error starting development environment:', error);
    process.exit(1);
  }
}

startDevWithPocketBase();