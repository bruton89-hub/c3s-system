import dotenv from 'dotenv';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });

function envValue(expoPublicKey, fallbackKey) {
  const value = (process.env[expoPublicKey] ?? process.env[fallbackKey] ?? '').trim();
  if (!value) {
    throw new Error(`Missing env var: ${expoPublicKey} (or ${fallbackKey})`);
  }
  return value;
}

const projectId = envValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID');
const emulatorHost = (process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
if (!emulatorHost || !projectId.startsWith('demo-')) {
  throw new Error('Development seeding is allowed only against a local emulator with a demo- project ID.');
}

const app = initializeApp({ projectId });
const db = getFirestore(app);
const doc = (firestore, collectionName, id) => firestore.collection(collectionName).doc(id);
const collection = (firestore, collectionName) => firestore.collection(collectionName);
const setDoc = (reference, data) => reference.set(data);
const limit = (count) => count;
const query = (reference, count) => reference.limit(count);
const getDocs = (reference) => reference.get();

async function seed() {
  const now = Timestamp.now();

  await setDoc(doc(db, 'products', 'product-dev-sausage'), {
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
    createdAt: now,
  });

  await setDoc(doc(db, 'products', 'product-dev-turkey'), {
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
    createdAt: now,
  });

  await setDoc(doc(db, 'products', 'product-dev-ham'), {
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
    createdAt: now,
  });

  await setDoc(doc(db, 'users', 'admin-dev-1'), {
    name: 'C3S Admin',
    role: 'admin',
    department: 'qa',
    active: true,
    createdAt: now,
  });

  await setDoc(doc(db, 'users', 'qa-dev-1'), {
    name: 'QA Lead',
    role: 'qa',
    department: 'qa',
    active: true,
    createdAt: now,
  });

  await setDoc(doc(db, 'users', 'operator-dev-1'), {
    name: 'Thermal Operator',
    role: 'operator',
    department: 'thermal',
    active: true,
    createdAt: now,
  });

  await setDoc(doc(db, 'users', 'packaging-dev-1'), {
    name: 'Packaging Operator',
    role: 'packaging',
    department: 'packaging',
    active: true,
    createdAt: now,
  });

  await setDoc(doc(db, 'smokehouses', 'smokehouse-dev-1'), {
    name: 'Smokehouse D',
    status: 'cooking',
    currentLoadId: 'prep-dev-4',
    lastCleanedAt: null,
  });

  await setDoc(doc(db, 'smokehouses', 'smokehouse-dev-2'), {
    name: 'Smokehouse E',
    status: 'idle',
    currentLoadId: null,
    lastCleanedAt: now,
  });

  await setDoc(doc(db, 'smokehouses', 'smokehouse-dev-3'), {
    name: 'Smokehouse F',
    status: 'cleaning',
    currentLoadId: null,
    lastCleanedAt: now,
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-1'), {
    productId: 'product-dev-ham',
    productName: 'Honey Baked Ham',
    productNameSnapshot: 'Honey Baked Ham',
    productCodeSnapshot: 'HAM-220',
    racks: 8,
    pieces: 320,
    poNumber: 'PO-1001',
    deliveryDate: '2026-04-28',
    makeDate: '2026-04-23',
    status: 'staging',
    startTime: now,
    createdBy: 'admin-dev-1',
    assignedSmokehouse: null,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    expectedChillMinutes: 80,
    expectedPackMinutes: 50,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-2'), {
    productId: 'product-dev-turkey',
    productName: 'Turkey Breast',
    productNameSnapshot: 'Turkey Breast',
    productCodeSnapshot: 'TRK-110',
    racks: 6,
    pieces: 180,
    poNumber: 'PO-1002',
    deliveryDate: '2026-04-29',
    makeDate: '2026-04-23',
    status: 'ready',
    startTime: now,
    createdBy: 'admin-dev-1',
    assignedSmokehouse: null,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    expectedChillMinutes: 75,
    expectedPackMinutes: 40,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-3'), {
    productId: 'product-dev-sausage',
    productName: 'Smoked Sausage',
    productNameSnapshot: 'Smoked Sausage',
    productCodeSnapshot: 'SSG-001',
    racks: 10,
    pieces: 360,
    poNumber: 'PO-1003',
    deliveryDate: '2026-04-30',
    makeDate: '2026-04-23',
    status: 'assigned',
    startTime: now,
    createdBy: 'admin-dev-1',
    assignedSmokehouse: 'Smokehouse E',
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    expectedChillMinutes: 70,
    expectedPackMinutes: 45,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-4'), {
    productId: 'product-dev-ham',
    productName: 'Honey Baked Ham',
    productNameSnapshot: 'Honey Baked Ham',
    productCodeSnapshot: 'HAM-220',
    racks: 7,
    pieces: 280,
    poNumber: 'PO-1004',
    deliveryDate: '2026-04-30',
    makeDate: '2026-04-23',
    status: 'cooking',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse D',
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    expectedChillMinutes: 80,
    expectedPackMinutes: 50,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-5'), {
    productId: 'product-dev-turkey',
    productName: 'Turkey Breast',
    productNameSnapshot: 'Turkey Breast',
    productCodeSnapshot: 'TRK-110',
    racks: 5,
    pieces: 150,
    poNumber: 'PO-1005',
    deliveryDate: '2026-05-01',
    makeDate: '2026-04-23',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse E',
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    expectedChillMinutes: 75,
    expectedPackMinutes: 40,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-6'), {
    productId: 'product-dev-sausage',
    productName: 'Smoked Sausage',
    productNameSnapshot: 'Smoked Sausage',
    productCodeSnapshot: 'SSG-001',
    racks: 11,
    pieces: 390,
    poNumber: 'PO-1006',
    deliveryDate: '2026-05-01',
    makeDate: '2026-04-23',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse D',
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    expectedChillMinutes: 70,
    expectedPackMinutes: 45,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-7'), {
    productId: 'product-dev-ham',
    productName: 'Honey Baked Ham',
    productNameSnapshot: 'Honey Baked Ham',
    productCodeSnapshot: 'HAM-220',
    racks: 6,
    pieces: 240,
    poNumber: 'PO-1007',
    deliveryDate: '2026-05-02',
    makeDate: '2026-04-24',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse E',
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    expectedChillMinutes: 80,
    expectedPackMinutes: 50,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-8'), {
    productId: 'product-dev-turkey',
    productName: 'Turkey Breast',
    productNameSnapshot: 'Turkey Breast',
    productCodeSnapshot: 'TRK-110',
    racks: 5,
    pieces: 160,
    poNumber: 'PO-1008',
    deliveryDate: '2026-05-02',
    makeDate: '2026-04-24',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse E',
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    expectedChillMinutes: 75,
    expectedPackMinutes: 40,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-9'), {
    productId: 'product-dev-sausage',
    productName: 'Smoked Sausage',
    productNameSnapshot: 'Smoked Sausage',
    productCodeSnapshot: 'SSG-001',
    racks: 9,
    pieces: 330,
    poNumber: 'PO-1009',
    deliveryDate: '2026-05-03',
    makeDate: '2026-04-24',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse D',
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    expectedChillMinutes: 70,
    expectedPackMinutes: 45,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'prep_queue', 'prep-dev-10'), {
    productId: 'product-dev-ham',
    productName: 'Honey Baked Ham',
    productNameSnapshot: 'Honey Baked Ham',
    productCodeSnapshot: 'HAM-220',
    racks: 8,
    pieces: 300,
    poNumber: 'PO-1010',
    deliveryDate: '2026-05-03',
    makeDate: '2026-04-24',
    status: 'awaiting_chill',
    startTime: now,
    createdBy: 'operator-dev-1',
    assignedSmokehouse: 'Smokehouse E',
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    expectedChillMinutes: 80,
    expectedPackMinutes: 50,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
  });

  await setDoc(doc(db, 'chillers', 'chiller-dev-1'), {
    name: 'Chiller 4',
    status: 'chilling',
    currentLoadId: 'prep-dev-6',
  });

  await setDoc(doc(db, 'chillers', 'chiller-dev-2'), {
    name: 'Chiller 5',
    status: 'idle',
    currentLoadId: null,
  });

  await setDoc(doc(db, 'chillers', 'chiller-dev-3'), {
    name: 'Chiller 6',
    status: 'cleaning',
    currentLoadId: null,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-1'), {
    chillerId: null,
    productName: 'Turkey Breast',
    prepId: 'prep-dev-5',
    timeTo50F: null,
    timeTo40F: null,
    status: 'waiting',
    createdAt: now,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
    makeDate: '2026-04-23',
    deliveryDate: '2026-05-01',
    racks: 5,
    pieces: 150,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-2'), {
    chillerId: 'chiller-dev-1',
    productName: 'Smoked Sausage',
    prepId: 'prep-dev-6',
    timeTo50F: null,
    timeTo40F: null,
    status: 'running',
    createdAt: now,
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-23',
    deliveryDate: '2026-05-01',
    racks: 11,
    pieces: 390,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-3'), {
    chillerId: null,
    productName: 'Honey Baked Ham',
    prepId: 'prep-dev-7',
    timeTo50F: 80,
    timeTo40F: 120,
    status: 'complete',
    createdAt: now,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-02',
    racks: 6,
    pieces: 240,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-4'), {
    chillerId: null,
    productName: 'Turkey Breast',
    prepId: 'prep-dev-8',
    timeTo50F: 75,
    timeTo40F: 110,
    status: 'complete',
    createdAt: now,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-02',
    racks: 5,
    pieces: 160,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-5'), {
    chillerId: null,
    productName: 'Smoked Sausage',
    prepId: 'prep-dev-9',
    timeTo50F: 78,
    timeTo40F: 115,
    status: 'complete',
    createdAt: now,
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-03',
    racks: 9,
    pieces: 330,
  });

  await setDoc(doc(db, 'chill_logs', 'chill-dev-6'), {
    chillerId: null,
    productName: 'Honey Baked Ham',
    prepId: 'prep-dev-10',
    timeTo50F: 82,
    timeTo40F: 121,
    status: 'complete',
    createdAt: now,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-03',
    racks: 8,
    pieces: 300,
  });

  await setDoc(doc(db, 'qa_checks', 'qa-dev-1'), {
    prepId: 'prep-dev-7',
    chillLogId: 'chill-dev-3',
    productName: 'Honey Baked Ham',
    type: 'chill',
    status: 'pending',
    notes: '',
    reviewedBy: null,
    reviewedAt: null,
    timestamp: now,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-02',
    racks: 6,
    pieces: 240,
  });

  await setDoc(doc(db, 'qa_checks', 'qa-dev-2'), {
    prepId: 'prep-dev-8',
    chillLogId: 'chill-dev-4',
    productName: 'Turkey Breast',
    type: 'chill',
    status: 'approved',
    notes: '',
    reviewedBy: 'qa-dev-1',
    reviewedAt: now,
    timestamp: now,
    cookType: 'steam',
    targetTemp: 165,
    expectedCookMinutes: 105,
    rackType: 'Poultry Rack',
    species: 'Turkey',
    packagingType: 'Tray Pack',
    thermalOwner: 'Thermal Team B',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-02',
    racks: 5,
    pieces: 160,
  });

  await setDoc(doc(db, 'qa_checks', 'qa-dev-3'), {
    prepId: 'prep-dev-9',
    chillLogId: 'chill-dev-5',
    productName: 'Smoked Sausage',
    type: 'chill',
    status: 'rejected',
    notes: 'Surface condensation exceeds acceptable threshold. Hold for rework.',
    reviewedBy: 'qa-dev-1',
    reviewedAt: now,
    timestamp: now,
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-03',
    racks: 9,
    pieces: 330,
  });

  await setDoc(doc(db, 'qa_checks', 'qa-dev-4'), {
    prepId: 'prep-dev-10',
    chillLogId: 'chill-dev-6',
    productName: 'Honey Baked Ham',
    type: 'chill',
    status: 'approved',
    notes: '',
    reviewedBy: 'qa-dev-1',
    reviewedAt: now,
    timestamp: now,
    cookType: 'smoke',
    targetTemp: 160,
    expectedCookMinutes: 120,
    rackType: 'Ham Tree Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    makeDate: '2026-04-24',
    deliveryDate: '2026-05-03',
    racks: 8,
    pieces: 300,
  });

  await setDoc(doc(db, 'packaging_logs', 'packaging-dev-1'), {
    prepId: 'prep-dev-8',
    qaCheckId: 'qa-dev-2',
    productName: 'Turkey Breast',
    casesProduced: null,
    unitsProduced: null,
    yieldPercent: null,
    packagingLine: 'Line 8600',
    packagedBy: 'packaging-dev-1',
    status: 'running',
    startedAt: now,
    completedAt: null,
    notes: '',
  });

  await setDoc(doc(db, 'packaging_logs', 'packaging-dev-2'), {
    prepId: 'prep-dev-10',
    qaCheckId: 'qa-dev-4',
    productName: 'Honey Baked Ham',
    casesProduced: 124,
    unitsProduced: 2480,
    yieldPercent: 98.4,
    packagingLine: 'Line 8614',
    packagedBy: 'packaging-dev-1',
    status: 'complete',
    startedAt: now,
    completedAt: now,
    notes: 'Pilot-ready completed lot.',
  });

  const operationalBase = {
    productId: 'product-dev-sausage',
    productName: 'Smoked Sausage with Extra Long Product Name for Floor Device QA',
    productCode: 'SSG-001',
    racks: 10,
    pieces: 360,
    deliveryDate: '2026-08-12',
    makeDate: '2026-08-10',
    cookType: 'smoke',
    targetTemp: 155,
    expectedCookMinutes: 95,
    expectedChillMinutes: 70,
    expectedPackMinutes: 45,
    rackType: 'Sausage Stick Rack',
    species: 'Pork',
    packagingType: 'Vacuum Pack',
    thermalOwner: 'Thermal Team A',
    criticalLimit: 'Configured process requirements apply',
    transitions: [],
    createdAt: Timestamp.fromMillis(Date.now() - 4 * 60 * 60 * 1000),
  };
  const operationalItems = [
    { id: 'batch-2840', poNumber: '2840', productName: 'Honey Baked Ham', stage: 'rtc', status: 'staging', prepQueueId: 'prep-dev-1', updatedAt: Timestamp.fromMillis(Date.now() - 50 * 60 * 1000) },
    { id: 'batch-2841', poNumber: '2841', stage: 'thermal', status: 'cooking', prepQueueId: 'prep-dev-4', assignedSmokehouse: 'Smokehouse D', cookStartedAt: Timestamp.fromMillis(Date.now() - 108 * 60 * 1000), updatedAt: Timestamp.fromMillis(Date.now() - 108 * 60 * 1000), hasDeviation: true, deviationNotes: 'Required temperature check overdue' },
    { id: 'batch-2842', poNumber: '2842', productName: 'Turkey Breast', stage: 'thermal', status: 'assigned', prepQueueId: 'prep-dev-3', assignedSmokehouse: 'Smokehouse E', updatedAt: Timestamp.fromMillis(Date.now() - 18 * 60 * 1000) },
    { id: 'batch-2843', poNumber: '2843', productName: 'Honey Baked Ham', stage: 'chill', status: 'awaiting_chill', prepQueueId: 'prep-dev-5', updatedAt: Timestamp.fromMillis(Date.now() - 42 * 60 * 1000) },
    { id: 'batch-2844', poNumber: '2844', productName: 'Turkey Breast', stage: 'chill', status: 'in_chill', prepQueueId: 'prep-dev-6', chillLogId: 'chill-dev-1', assignedChiller: 'Chiller 10', updatedAt: Timestamp.fromMillis(Date.now() - 31 * 60 * 1000) },
    { id: 'batch-2845', poNumber: '2845', productName: 'Smoked Sausage', stage: 'qa', status: 'ready_for_qa', prepQueueId: 'prep-dev-7', qaCheckId: 'qa-dev-1', updatedAt: Timestamp.fromMillis(Date.now() - 27 * 60 * 1000) },
    { id: 'batch-2846', poNumber: '2846', productName: 'Honey Baked Ham', stage: 'qa', status: 'hold', prepQueueId: 'prep-dev-8', updatedAt: Timestamp.fromMillis(Date.now() - 73 * 60 * 1000), activeHold: { reasonKey: 'qa_review', reasonLabel: 'QA Review', placedBy: 'qa-dev-1', placedByName: 'QA Lead', placedAt: Timestamp.fromMillis(Date.now() - 73 * 60 * 1000), preHoldStage: 'qa', preHoldStatus: 'ready_for_qa' } },
    { id: 'batch-2847', poNumber: '2847', productName: 'Turkey Breast', stage: 'packaging', status: 'packaging_in_progress', prepQueueId: 'prep-dev-9', packagingLogId: 'packaging-dev-1', updatedAt: Timestamp.fromMillis(Date.now() - 22 * 60 * 1000) },
    { id: 'batch-2839', poNumber: '2839', productName: 'Honey Baked Ham', stage: 'complete', status: 'complete', prepQueueId: 'prep-dev-10', packagingLogId: 'packaging-dev-2', updatedAt: Timestamp.fromMillis(Date.now() - 12 * 60 * 1000) },
  ];
  for (const item of operationalItems) {
    const { id, ...data } = item;
    await setDoc(doc(db, 'operational_items', id), { ...operationalBase, ...data });
  }

  const checks = await Promise.all([
    getDocs(query(collection(db, 'products'), limit(1))),
    getDocs(query(collection(db, 'prep_queue'), limit(1))),
    getDocs(query(collection(db, 'smokehouses'), limit(1))),
    getDocs(query(collection(db, 'chill_logs'), limit(1))),
    getDocs(query(collection(db, 'qa_checks'), limit(1))),
    getDocs(query(collection(db, 'packaging_logs'), limit(1))),
    getDocs(query(collection(db, 'operational_items'), limit(1))),
  ]);

  console.log(
    `Seed complete. products:${checks[0].size} prep_queue:${checks[1].size} smokehouses:${checks[2].size} chill_logs:${checks[3].size} qa_checks:${checks[4].size} packaging_logs:${checks[5].size} operational_items:${checks[6].size}`,
  );
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
