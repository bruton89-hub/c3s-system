/**
 * Seed the `product_profiles` Firestore collection from the runtime
 * reference sheet (deli thermal operations master).
 *
 * Idempotent: each profile is written at a stable docId, so re-running this
 * script updates rather than duplicates.
 *
 *   npm run seed:product-profiles
 */
import dotenv from 'dotenv';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });

function envValue(...keys) {
  const value = keys.map((k) => process.env[k]).find((v) => (v ?? '').trim())?.trim() ?? '';
  if (!value) {
    throw new Error(`Missing env var: ${keys.join(' or ')}`);
  }
  return value;
}

function initAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? '').trim();
  const serviceAccountJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim();

  if (serviceAccountJson) {
    let creds;
    try {
      creds = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
    return initializeApp({
      credential: cert(creds),
      ...(projectId ? { projectId } : {}),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

const app = initAdminApp();
const db = getFirestore(app);

// Inline copy of seed data — mjs scripts don't import the TS module directly.
// Keep this in sync with /lib/products/seed-data.ts when values change.
const PRODUCT_PROFILE_SEED = [
  // ── Salad Items ──────────────────────────────────────────────────────────
  ['pp-296359','296359','PUO Salad Chicken','salad_items','poultry','uncured','','160°/26.9 sec','Combo',175,30,18,7.58,0,12,'turkey_room',['Master shows alt rack capacity 12.']],
  ['pp-319732','319732','Chopped Ham','salad_items','pork','cured','','152°/46 sec','Combo',152,45,0,8,0,9.5,'process_meats',['Rack capacity not legible on master.']],

  // ── Fresh Kitchen Items ──────────────────────────────────────────────────
  ['pp-247788','247788','MUO Spanish Pork','fresh_kitchen','pork','uncured','','158°','Combo',162,30,18,7.5,7,6,'ham_stuffing',[]],
  ['pp-247789','247789','MUO Sweet Ham','fresh_kitchen','pork','cured','','152°/46 sec','Combo',155,45,18,6.5,0,11.75,'ham_stuffing',[]],
  ['pp-247790','247790','MUO ORTB','fresh_kitchen','pork','cured','','152°/46 sec','Combo',155,45,18,10.92,0,11.75,'ham_stuffing',[]],
  ['pp-247792','247792','MUO Top Rounds','fresh_kitchen','beef','uncured','','160°/26.9 sec','Combo',168,45,18,6.5,0,9.5,'boning_room',[]],
  ['pp-247797','247797','MUO Tavern Ham','fresh_kitchen','pork','cured','hickory','135°/37 min','Combo',136,45,18,6.67,0,9.5,'ham_stuffing',[]],
  ['pp-261070','261070','MUO Cappy Ham','fresh_kitchen','pork','cured','','152°/46 sec','Combo',155,45,18,6.5,0,9.5,'ham_stuffing',['Verify cook/chill on next print.']],
  ['pp-266950','266950','MUO Salami','fresh_kitchen','pork','cured','','152°/46 sec','Combo',155,50,18,10,7.5,6,'process_meats',[]],
  ['pp-268338','268338','MUO Mojo Pork','fresh_kitchen','pork','cured','','158°','Combo',185,45,18,11.17,7.5,6,'process_meats',[]],
  ['pp-327936','327936','MUO Tavern Chicken','fresh_kitchen','poultry','uncured','','160°/26.9 sec','Combo',165,45,18,8.58,7,6,'turkey_room',[]],

  // ── Bulk Items ───────────────────────────────────────────────────────────
  ['pp-51912','51912','SBH Wholes','bulk_items','pork','cured','','152°/46 sec','NV',155,45,18,11.17,9,8,'ham_stuffing',[]],
  ['pp-51913','51913','SBH Halves','bulk_items','pork','cured','','152°/46 sec','NV',155,70,18,12.33,13,10.25,'ham_stuffing',[]],
  ['pp-90046','90046','Tavern Ham','bulk_items','pork','cured','hickory','152°/46 sec','Misc',155,50,18,9,0,10.25,'ham_stuffing',[]],
  ['pp-90047','90047','Sweet Ham','bulk_items','pork','cured','hickory','152°/46 sec','Misc',155,45,18,10.75,0,7.75,'ham_stuffing',[]],
  ['pp-90182','90182','Smoked Turkey Breast (Bib)','bulk_items','poultry','uncured','hickory','155°','Misc',162,18,12,8.5,11.75,5,'turkey_room',[]],
  ['pp-90274','90274','Healthy L/S Turkey Breast','bulk_items','poultry','uncured','hickory','155°/1.3 min','Misc',162,45,12,6.75,5,9,'turkey_room',[]],
  ['pp-90291','90291','Smoked Tavern Chicken','bulk_items','poultry','uncured','hickory','160°/26.9 sec','MB',165,45,18,6.75,0,5.75,'turkey_room',[]],
  ['pp-90445','90445','Premier ORTB / Turkey Breast O/R','bulk_items','poultry','uncured','','160°/26.9 sec','MB',165,45,18,10.5,7,9,'turkey_room',[]],
  ['pp-90466','90466','Cooked Ham 15%','bulk_items','pork','cured','','152°/46 sec','Misc',162,45,18,8.25,7.5,9.5,'ham_stuffing',[]],
  ['pp-96187','96187','Smoked Turkey (WOG)','bulk_items','poultry','uncured','hickory','152°/46 sec','Misc',152,150,18,8.75,0,8.25,'turkey_room',[]],
  ['pp-97739','97739','Beef Top Round','bulk_items','beef','uncured','','135°/1.3 min','NV',136,12,18,7,7,8.75,'boning_room',[]],
  ['pp-99522','99522','Spanish Pork','bulk_items','pork','uncured','','158°','NV',162,30,18,6.75,7,5,'process_meats',[]],
  ['pp-227974','227974','Pork Ribs Smoked','bulk_items','pork','cured','oak','158°','MB',162,18,18,6.5,0,11.75,'boning_room',[]],
  ['pp-227975','227975','Pork Butts Smoked','bulk_items','pork','uncured','oak','158°','NV',160,45,18,6.5,9.5,9,'boning_room',[]],
  ['pp-946822','946822','Pork Roast Mojo','bulk_items','pork','uncured','','158°','NV',185,45,18,12.25,3,2,'boning_room',[]],

  // ── Slicing Items ────────────────────────────────────────────────────────
  ['pp-874478','874478','Sliced Tavern Ham','slicing_items','pork','cured','hickory','152°/46 sec','Misc',155,50,18,11.17,9,8,'ham_stuffing',[]],
  ['pp-874481','874481','Sliced Cooked Ham','slicing_items','pork','cured','','152°/46 sec','Misc',152,50,18,12.25,3,2,'ham_stuffing',[]],
  ['pp-874482','874482','Sliced Ham L/S','slicing_items','pork','cured','','152°/46 sec','Misc',152,18,18,7,7,5.75,'ham_stuffing',[]],
  ['pp-874483','874483','Sliced Sweet','slicing_items','pork','cured','','152°/46 sec','Misc',155,18,18,9.25,0,13,'ham_stuffing',[]],
  ['pp-874544','874544','Smoked Sliced Turkey','slicing_items','poultry','cured','','160°/26.9 sec','Misc',168,18,18,10,0,11.75,'turkey_room',[]],
  ['pp-874545','874545','Deli Sliced Turkey','slicing_items','poultry','uncured','','160°/26.9 sec','Misc',168,18,18,10.92,0,11,'turkey_room',[]],
];

const FIELDS = [
  'docId','productCode','productName','category','species','processType','smokeType',
  'criticalLimit','boxType','probeOutTemp','shelfLifeDays','rackCapacity',
  'estimatedCookTimeHours','estimatedChillTimeHours','estimatedBlastCellHours',
  'productionSection','notes',
];

function tupleToProfile(t) {
  const obj = {};
  FIELDS.forEach((k, i) => { obj[k] = t[i]; });
  obj.preferredSmokehouses = [];
  obj.active = true;
  return obj;
}

async function seedProductProfiles() {
  const createdAt = Timestamp.now();
  let written = 0;
  for (const tuple of PRODUCT_PROFILE_SEED) {
    const p = tupleToProfile(tuple);
    const { docId, ...rest } = p;
    await db.collection('product_profiles').doc(docId).set(
      { ...rest, createdAt, updatedAt: createdAt },
      { merge: true },
    );
    written += 1;
  }

  const check = await db.collection('product_profiles').limit(50).get();
  console.log(`Product profiles seed complete. Wrote ${written}. Collection check count: ${check.size}`);
}

seedProductProfiles().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes('could not load the default credentials') ||
    lower.includes('default credentials') ||
    lower.includes('application default credentials')
  ) {
    console.error('Missing Google Application Default Credentials (ADC).');
    console.error('Run: gcloud auth application-default login');
    console.error('Or set GOOGLE_SERVICE_ACCOUNT_JSON to a valid service account JSON payload.');
  }
  console.error('Product profiles seed failed:', error);
  process.exit(1);
});
