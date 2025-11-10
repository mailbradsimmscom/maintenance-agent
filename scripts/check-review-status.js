import db from '../src/repositories/supabase.repository.js';

const assetUid = process.argv[2] || '87517a2e-8bc4-8379-5718-e88bb81cb796';

const { data: reviews } = await db.client
  .from('deduplication_reviews')
  .select('id, asset_uid, reviewed_at, decision')
  .eq('asset_uid', assetUid);

console.log('Asset UID:', assetUid);
console.log('Total reviews:', reviews?.length || 0);
const pending = reviews?.filter(r => r.decision === null) || [];
const decided = reviews?.filter(r => r.decision) || [];
console.log('Pending:', pending.length);
console.log('Decided:', decided.length);
if (decided.length > 0) {
  const decisions = {};
  decided.forEach(r => {
    decisions[r.decision] = (decisions[r.decision] || 0) + 1;
  });
  console.log('Decision breakdown:', decisions);
}
