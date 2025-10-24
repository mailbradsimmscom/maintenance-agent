/**
 * Comprehensive Test Runner for Phases 1-3
 * Runs all tests and provides summary
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Running: ${scriptPath}`);
    console.log('='.repeat(60));

    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, script: scriptPath });
      } else {
        resolve({ success: false, script: scriptPath, code });
      }
    });

    child.on('error', (error) => {
      reject({ success: false, script: scriptPath, error: error.message });
    });
  });
}

async function runAllTests() {
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(10) + '🧪 PHASE 1-3 TEST SUITE' + ' '.repeat(25) + '║');
  console.log('║' + ' '.repeat(10) + 'Testing Database → Repos → Services' + ' '.repeat(11) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');

  const results = [];

  // Test Phase 2: Repositories
  const repoTest = await runScript(join(__dirname, 'test-repositories.js'));
  results.push(repoTest);

  // Test Phase 3: Services
  const serviceTest = await runScript(join(__dirname, 'test-services.js'));
  results.push(serviceTest);

  // Summary
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(20) + '📊 FINAL SUMMARY' + ' '.repeat(22) + '║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    const scriptName = result.script.split('/').pop();
    console.log(`${status} ${scriptName}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`Total Test Suites: ${results.length}`);
  console.log(`✅ Passed: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((successful / results.length) * 100)}%`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) {
    console.log('⚠️  Some tests failed. Review output above for details.\n');
    process.exit(1);
  } else {
    console.log('🎉 All test suites passed! Phases 1-3 are working correctly.\n');
    process.exit(0);
  }
}

// Run all tests
runAllTests().catch(error => {
  console.error('\n❌ Test runner failed:', error);
  process.exit(1);
});
