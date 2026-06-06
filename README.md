# C3S System

C3S is a plant-flow prototype for tracking product movement through:

RTC -> Thermal -> Post-Cook/Chill -> QA -> Packaging

## Current scope
- Plant Flow quick view
- RTC queue and thermal assignment handoff
- Thermal execution tracking
- Packaging operations view
- Alerts
- Weekly run planner / cook forecast

## Notes
- Demo / mock data only
- No backend integration yet
- Built to mirror real plant movement and ownership handoffs

## Firebase foundation (manual and explicit)
- Firebase config is in `lib/firebase/config.ts` (App + Firestore + Auth only).
- Firestore models and collection helpers are in `lib/firebase/models.ts` and `lib/firebase/collections.ts`.
- Repository helpers are in `lib/firebase/repository.ts`.
- Dev seed script is `scripts/seed-dev.mjs`.

No Cloud Functions, triggers, or analytics logic are wired.
