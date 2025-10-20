// Check database schema for maintenance agent
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkSchema() {
  console.log('Checking database schema...\n');

  // 1. Check systems table structure
  console.log('=== SYSTEMS TABLE ===');
  const { data: systems, error: sysError } = await supabase
    .from('systems')
    .select('*')
    .limit(1);

  if (sysError) {
    console.error('Error reading systems:', sysError);
  } else if (systems && systems[0]) {
    console.log('Sample system record:');
    console.log(JSON.stringify(systems[0], null, 2));
    console.log('\nAvailable fields:', Object.keys(systems[0]));
  }

  // 2. Check if maintenance_agent_memory exists
  console.log('\n=== MAINTENANCE_AGENT_MEMORY TABLE ===');
  const { data: memory, error: memError } = await supabase
    .from('maintenance_agent_memory')
    .select('*')
    .limit(1);

  if (memError) {
    if (memError.message.includes('relation') && memError.message.includes('does not exist')) {
      console.log('❌ Table does not exist - needs to be created');
    } else {
      console.error('Error:', memError.message);
    }
  } else {
    console.log('✅ Table exists');
    if (memory && memory[0]) {
      console.log('Fields:', Object.keys(memory[0]));
    }
  }

  // 3. Check if maintenance_tasks_queue exists
  console.log('\n=== MAINTENANCE_TASKS_QUEUE TABLE ===');
  const { data: queue, error: queueError } = await supabase
    .from('maintenance_tasks_queue')
    .select('*')
    .limit(1);

  if (queueError) {
    if (queueError.message.includes('relation') && queueError.message.includes('does not exist')) {
      console.log('❌ Table does not exist - needs to be created');
    } else {
      console.error('Error:', queueError.message);
    }
  } else {
    console.log('✅ Table exists');
    if (queue && queue[0]) {
      console.log('Fields:', Object.keys(queue[0]));
    }
  }

  // 4. Check documents table for manual extraction
  console.log('\n=== DOCUMENTS TABLE ===');
  const { data: docs, error: docsError } = await supabase
    .from('documents')
    .select('*')
    .limit(1);

  if (docsError) {
    console.error('Error reading documents:', docsError.message);
  } else {
    console.log('✅ Table exists');
    if (docs && docs[0]) {
      console.log('Fields:', Object.keys(docs[0]));
    }
  }

  // 5. Check document_chunks for Pinecone integration
  console.log('\n=== DOCUMENT_CHUNKS TABLE ===');
  const { data: chunks, error: chunksError } = await supabase
    .from('document_chunks')
    .select('*')
    .limit(1);

  if (chunksError) {
    console.error('Error reading document_chunks:', chunksError.message);
  } else {
    console.log('✅ Table exists');
    if (chunks && chunks[0]) {
      console.log('Fields:', Object.keys(chunks[0]));
    }
  }
}

checkSchema().catch(console.error);