import { addDoc, getDocs, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { auth } from '@/lib/firebase/config'; import { collectionRef } from '@/lib/firebase/collections'; import type { HandoffNoteDoc } from '@/lib/firebase/models';
import { HANDOFF_NOTES_ENABLED } from './config'; import { validateHandoffNote } from './core';

export async function addHandoffNote(input: { handoffId: string; shiftDate: string; note: string; authorName: string; itemIds?: string[] }) {
  if (!HANDOFF_NOTES_ENABLED) throw new Error('Handoff notes are disabled in this environment.'); const user = auth?.currentUser; if (!user) throw new Error('Sign in is required.');
  const ref = await addDoc(collectionRef('handoff_notes'), { handoffId: input.handoffId, shiftDate: input.shiftDate, note: validateHandoffNote(input.note), authorId: user.uid, authorName: input.authorName, createdAt: serverTimestamp(), itemIds: [...new Set(input.itemIds ?? [])].slice(0, 25) } as unknown as HandoffNoteDoc); return ref.id;
}
export async function getHandoffNotes(handoffId: string) { const result = await getDocs(query(collectionRef('handoff_notes'), where('handoffId', '==', handoffId), orderBy('createdAt', 'desc'))); return result.docs.map((entry) => ({ id: entry.id, ...entry.data() })); }
