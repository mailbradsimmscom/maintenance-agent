/**
 * Debug Script: Find Zerojet
 * Check if zerojet exists in systems and documents tables
 */

import db from '../src/repositories/supabase.repository.js';

async function debugZerojet() {
  console.log('\n=== DEBUGGING ZEROJET ===\n');

  // Check systems table
  console.log('1. Checking systems table...');
  const { data: systems, error: sysError } = await db.client
    .from('systems')
    .select('asset_uid, description, manufacturer_norm, model_norm, system_norm')
    .or('description.ilike.%zerojet%,manufacturer_norm.ilike.%zerojet%,model_norm.ilike.%zerojet%,system_norm.ilike.%zerojet%');

  if (sysError) {
    console.error('Error querying systems:', sysError);
  } else {
    console.log(`Found ${systems?.length || 0} systems with "zerojet":`);
    systems?.forEach(s => {
      console.log(`  - ${s.asset_uid}`);
      console.log(`    Description: ${s.description}`);
      console.log(`    Manufacturer: ${s.manufacturer_norm}`);
      console.log(`    Model: ${s.model_norm}`);
      console.log(`    System: ${s.system_norm}`);
      console.log('');
    });
  }

  // Check documents table (just asset_uid like the pipeline route does)
  console.log('2. Checking all documents in the table...');
  const { data: allDocs, error: allDocsError } = await db.client
    .from('documents')
    .select('asset_uid');

  if (allDocsError) {
    console.error('Error querying all documents:', allDocsError);
  } else {
    console.log(`Total documents in table: ${allDocs?.length || 0}`);
    const uniqueAssetUids = [...new Set(allDocs?.map(d => d.asset_uid).filter(Boolean) || [])];
    console.log(`Unique asset_uids with documents: ${uniqueAssetUids.length}`);
  }

  // If we found systems, check if they have documents
  if (systems && systems.length > 0) {
    console.log('\n3. Checking if zerojet systems have documents...');
    const assetUids = systems.map(s => s.asset_uid);
    console.log(`Zerojet asset_uids: ${assetUids.join(', ')}`);

    const { data: docsForSystem, error: docsForSysError } = await db.client
      .from('documents')
      .select('asset_uid')
      .in('asset_uid', assetUids);

    if (docsForSysError) {
      console.error('Error:', docsForSysError);
    } else {
      console.log(`Found ${docsForSystem?.length || 0} documents for zerojet systems`);
      if (docsForSystem && docsForSystem.length > 0) {
        const groupedByAsset = {};
        docsForSystem.forEach(d => {
          groupedByAsset[d.asset_uid] = (groupedByAsset[d.asset_uid] || 0) + 1;
        });
        Object.entries(groupedByAsset).forEach(([uid, count]) => {
          console.log(`  ✅ ${uid}: ${count} document(s)`);
        });
      } else {
        console.log('\n  ❌ NO DOCUMENTS FOUND FOR ZEROJET!');
        console.log('  This is why zerojet doesn\'t appear in agent-status.html');
        console.log('\n  To fix: Upload PDFs for zerojet systems with these asset_uids:');
        assetUids.forEach(uid => console.log(`    - ${uid}`));
      }
    }
  }

  console.log('\n=== END DEBUG ===\n');
  process.exit(0);
}

debugZerojet().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
