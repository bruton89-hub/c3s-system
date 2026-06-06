import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, limit, query, setDoc, Timestamp } from 'firebase/firestore';

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

async function seedProducts() {
  const createdAt = Timestamp.now();

  await setDoc(doc(db, 'products', 'prod-smoked-sausage'), {
    name: 'Smoked Sausage',
    code: 'SSG-001',
    defaultRacks: 12,
    defaultPieces: 420,
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    rackType: 'Sausage Stick Rack',
    expectedChillMinutes: 70,
    expectedPackMinutes: 45,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-turkey-breast'), {
    name: 'Turkey Breast',
    code: 'TRK-110',
    defaultRacks: 6,
    defaultPieces: 180,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    rackType: 'Poultry Rack',
    expectedChillMinutes: 75,
    expectedPackMinutes: 40,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-honey-baked-ham'), {
    name: 'Honey Baked Ham',
    code: 'HAM-220',
    defaultRacks: 8,
    defaultPieces: 320,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    rackType: 'Ham Tree Rack',
    expectedChillMinutes: 80,
    expectedPackMinutes: 50,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-beef-frank'), {
    name: 'Beef Frank',
    code: 'BFK-305',
    defaultRacks: 10,
    defaultPieces: 360,
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 90,
    rackType: 'Sausage Stick Rack',
    expectedChillMinutes: 68,
    expectedPackMinutes: 42,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-chicken-sausage'), {
    name: 'Chicken Sausage',
    code: 'CHK-410',
    defaultRacks: 11,
    defaultPieces: 390,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 92,
    rackType: 'Combo Rack',
    expectedChillMinutes: 72,
    expectedPackMinutes: 44,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-maple-bacon'), {
    name: 'Maple Bacon',
    code: 'BCN-515',
    defaultRacks: 14,
    defaultPieces: 560,
    cookType: 'smoke',
    targetTemp: 150,
    expectedCookMinutes: 130,
    rackType: 'Belly Rack',
    expectedChillMinutes: 85,
    expectedPackMinutes: 55,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-roast-beef'), {
    name: 'Roast Beef',
    code: 'RBF-612',
    defaultRacks: 7,
    defaultPieces: 210,
    cookType: 'steam',
    targetTemp: 158,
    expectedCookMinutes: 115,
    rackType: 'Roast Rack',
    expectedChillMinutes: 78,
    expectedPackMinutes: 48,
    active: true,
    createdAt,
  });

  await setDoc(doc(db, 'products', 'prod-deli-ham'), {
    name: 'Deli Ham',
    code: 'DLH-709',
    defaultRacks: 9,
    defaultPieces: 330,
    cookType: 'smoke',
    targetTemp: 158,
    expectedCookMinutes: 110,
    rackType: 'Ham Tree Rack',
    expectedChillMinutes: 76,
    expectedPackMinutes: 46,
    active: true,
    createdAt,
  });

  const check = await getDocs(query(collection(db, 'products'), limit(20)));
  console.log(`Products seed complete. products collection check count: ${check.size}`);
}

seedProducts().catch((error) => {
  console.error('Products seed failed:', error);
  process.exit(1);
});
