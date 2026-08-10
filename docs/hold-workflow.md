# Formal production holds

Formal holds store a current `activeHold` snapshot on the canonical operational item and immutable history in `hold_events`.

Placement records the reason, optional notes, authenticated actor, server timestamp, and the exact previous stage/status. The canonical transition validator must approve the move to `hold`. While held, normal Firestore updates that attempt to leave `hold` are denied by rules unless the actor can resolve holds and clears `activeHold` through the formal workflow.

The only supported disposition is **Released to Production**, which returns the item to its recorded pre-hold stage/status. Rework, escalation, rejection, and destructive outcomes are not offered because the existing state machine cannot represent them safely.

QA-managed holds continue through the established QA review/resubmission repository so QA validations remain authoritative. Their transition notes and reviewer identity appear in Production Item history. A future backend unification can emit `hold_events` atomically alongside the existing QA document mutation.

No existing transition rule is bypassed: both placement and release use the canonical transition validator, and Firestore rules protect the formal hold boundary.
