import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

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

async function countCollection(name) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.size;
}

async function run() {
  const productProfiles = await countCollection('product_profiles');
  const legacyProducts = await countCollection('products');
  const users = await countCollection('users');
  const prepQueue = await countCollection('prep_queue');
  const smokehouses = await countCollection('smokehouses');
  const chillers = await countCollection('chillers');
  const chillLogs = await countCollection('chill_logs');
  const qaChecks = await countCollection('qa_checks');
  const packagingLogs = await countCollection('packaging_logs');

  console.log('C3S Data State');
  console.log(`product_profiles: ${productProfiles}`);
  console.log(`products (legacy): ${legacyProducts}`);
  console.log(`users: ${users}`);
  console.log(`prep_queue: ${prepQueue}`);
  console.log(`smokehouses: ${smokehouses}`);
  console.log(`chillers: ${chillers}`);
  console.log(`chill_logs: ${chillLogs}`);
  console.log(`qa_checks: ${qaChecks}`);
  console.log(`packaging_logs: ${packagingLogs}`);

  const missingCoreData = productProfiles === 0 || prepQueue === 0 || smokehouses === 0;
  if (missingCoreData) {
    console.log('Status: WARNING - Core collections are missing pilot data.');
    process.exitCode = 1;
    return;
  }

  console.log('Status: OK - Core pilot collections have data.');
}

run().catch((error) => {
  console.error('Data state check failed:', error);
  process.exit(1);
});
