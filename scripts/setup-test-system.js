/**
 * Setup Test System
 * Creates a test system in the database for testing
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../src/config/env.js';

const config = getConfig();
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

const TEST_ASSET_UID = '00000000-0000-0000-0000-000000000999';

async function setupTestSystem() {
  console.log('🔧 Setting up test system...\n');

  try {
    // Check if test system already exists
    const { data: existing } = await supabase
      .from('systems')
      .select('*')
      .eq('asset_uid', TEST_ASSET_UID)
      .single();

    if (existing) {
      console.log('✅ Test system already exists:', {
        asset_uid: existing.asset_uid,
        system_norm: existing.system_norm,
      });
      return existing;
    }

    // Create test system
    const { data, error } = await supabase
      .from('systems')
      .insert({
        asset_uid: TEST_ASSET_UID,
        system_norm: 'Test System for Phase 1-3',
        manufacturer_norm: 'Test Manufacturer',
        model_norm: 'Test Model',
        description: 'Test system for Phase 1-3 testing',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log('✅ Created test system:', {
      asset_uid: data.asset_uid,
      system_norm: data.system_norm,
    });

    return data;

  } catch (error) {
    console.error('❌ Failed to setup test system:', error.message);
    throw error;
  }
}

// Run setup
setupTestSystem()
  .then(() => {
    console.log('\n🎉 Test system ready!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  });
