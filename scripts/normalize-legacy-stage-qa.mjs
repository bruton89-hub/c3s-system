import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  writeBatch,
} from 'firebase/firestore';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });

function envValue(expoPublicKey, fallbackKey) {
  const value = (process.env[expoPublicKey] ?? process.env[fallbackKey] ?? '').trim();
  if (!value) {
    throw new Error(`Missing env var: ${expoPublicKey} (or ${fallbackKey})`);
  }
  return value;
}

const firebaseConfig = {
  apiKey: envValue('EXPO_PUBLIC_FIREBASE_API_KEY', 'FIREBASE_API_KEY'),
  authDomain: envValue('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'FIREBASE_AUTH_DOMAIN'),
  projectId: envValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID'),
  storageBucket: envValue('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: envValue('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID'),
  appId: envValue('EXPO_PUBLIC_FIREBASE_APP_ID', 'FIREBASE_APP_ID'),
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const shouldCommit = process.argv.includes('--commit');
const BATCH_LIMIT = 400;

const legacyQaStatusMap = {
  pending: 'ready_for_qa',
  approved: 'ready_for_packaging',
  rejected: 'qa_review_required',
};

function inferStageFromPrepStatus(status) {
  if (status === 'staging') return 'rtc';
  if (status === 'ready' || status === 'assigned' || status === 'cooking') return 'thermal';
  if (status === 'awaiting_chill') return 'chill';
  if (status === 'ready_for_qa' || status === 'qa_hold' || status === 'qa_review_required') return 'qa';
  if (status === 'ready_for_packaging') return 'packaging';
  return null;
}

function inferPrepStatusFromQaStatus(status) {
  if (status === 'ready_for_qa') return 'ready_for_qa';
  if (status === 'qa_hold') return 'qa_hold';
  if (status === 'qa_review_required') return 'qa_review_required';
  if (status === 'ready_for_packaging') return 'ready_for_packaging';
  return null;
}

async function commitBatches(writes) {
  if (writes.length === 0) return;
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const chunk = writes.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach((w) => batch.update(w.ref, w.data));
    await batch.commit();
  }
}

async function run() {
  const qaSnapshot = await getDocs(collection(db, 'qa_checks'));
  const prepSnapshot = await getDocs(collection(db, 'prep_queue'));

  const qaWrites = [];
  const prepWrites = [];
  let qaMapped = 0;
  let prepStageFilled = 0;
  let prepStatusAlignedFromQa = 0;
  let skippedPrep = 0;

  // 1) Normalize legacy QA statuses on qa_checks.
  for (const row of qaSnapshot.docs) {
    const data = row.data();
    const mapped = legacyQaStatusMap[data.status];
    if (!mapped) continue;
    qaWrites.push({
      ref: doc(db, 'qa_checks', row.id),
      data: { status: mapped },
    });
    qaMapped += 1;
  }

  // 2) Add missing stage on prep_queue and normalize legacy/missing status from linked QA where possible.
  // Build prepId -> best QA status (latest by timestamp not required for one-time normalization;
  // we pick a deterministic precedence for safe stage routing).
  const qaStatusByPrepId = new Map();
  const qaStatusPriority = {
    ready_for_packaging: 4,
    qa_review_required: 3,
    qa_hold: 2,
    ready_for_qa: 1,
    approved: 4,
    rejected: 3,
    pending: 1,
  };
  for (const row of qaSnapshot.docs) {
    const data = row.data();
    if (!data.prepId) continue;
    const current = qaStatusByPrepId.get(data.prepId);
    const nextPriority = qaStatusPriority[data.status] ?? 0;
    const currentPriority = current ? qaStatusPriority[current] ?? 0 : 0;
    if (!current || nextPriority >= currentPriority) {
      qaStatusByPrepId.set(data.prepId, data.status);
    }
  }

  for (const row of prepSnapshot.docs) {
    const data = row.data();
    const update = {};

    if (!data.stage) {
      const inferred = inferStageFromPrepStatus(data.status);
      if (inferred) {
        update.stage = inferred;
        prepStageFilled += 1;
      }
    }

    const linkedQaStatus = qaStatusByPrepId.get(row.id);
    if (linkedQaStatus) {
      const normalizedQaStatus = legacyQaStatusMap[linkedQaStatus] ?? linkedQaStatus;
      const normalizedPrepStatus = inferPrepStatusFromQaStatus(normalizedQaStatus);
      if (normalizedPrepStatus && data.status !== normalizedPrepStatus) {
        update.status = normalizedPrepStatus;
        if (!update.stage) {
          update.stage = normalizedPrepStatus === 'ready_for_packaging' ? 'packaging' : 'qa';
        }
        prepStatusAlignedFromQa += 1;
      }
    }

    if (Object.keys(update).length === 0) {
      if (!data.stage && !inferStageFromPrepStatus(data.status) && !linkedQaStatus) {
        skippedPrep += 1;
      }
      continue;
    }

    prepWrites.push({
      ref: doc(db, 'prep_queue', row.id),
      data: update,
    });
  }

  console.log('Legacy normalization summary');
  console.log(`Mode: ${shouldCommit ? 'COMMIT' : 'DRY RUN'}`);
  console.log(`qa_checks legacy statuses to map: ${qaMapped}`);
  console.log(`prep_queue stage fields to fill: ${prepStageFilled}`);
  console.log(`prep_queue statuses aligned from QA: ${prepStatusAlignedFromQa}`);
  console.log(`prep_queue skipped (insufficient inference): ${skippedPrep}`);
  console.log(`Total qa writes: ${qaWrites.length}`);
  console.log(`Total prep writes: ${prepWrites.length}`);

  if (!shouldCommit) {
    console.log('No changes written. Re-run with --commit to apply.');
    return;
  }

  await commitBatches(qaWrites);
  await commitBatches(prepWrites);
  console.log('Normalization committed successfully.');
}

run().catch((error) => {
  console.error('Normalization failed:', error);
  process.exit(1);
});
