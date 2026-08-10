# C3S Security Role Matrix

UI visibility is a usability control only. Firestore rules or callable Functions are authoritative.

| Sensitive action | Operator UI/client/rules | Supervisor UI/client/rules | QA UI/client/rules | Admin UI/client/rules | Server required | Audit |
|---|---|---|---|---|---|---|
| View production | Visible / read / allowed | Same | Same | Same | No | No |
| Create/edit plan | Hidden / denied / denied | Visible / allowed / allowed | Hidden / denied / denied | Visible / allowed / allowed | No for edits | created fields protected |
| Send plan/manual entry to RTC | Contextual / callable / direct rules denied | Visible / callable | Hidden | Visible / callable | Yes | event + receipt |
| RTC/Thermal/Chill checks | Visible / callable / direct rules denied | Visible / callable | QA-context checks only | Visible / callable | Yes | event + receipt |
| Assign oven/chiller | Visible / callable / direct rules denied | Visible / callable | Hidden | Visible / callable | Yes | event + receipt |
| Advance stage | Contextual / callable / direct rules denied | Same | QA stages only | All valid stages | Yes | transition + event + receipt |
| Acknowledge alert | Visible / allowed / allowed | Same | Same | Same | No | alert event |
| Resolve alert | Hidden unless authorized / denied | Visible / allowed | Visible / allowed | Visible / allowed | No | alert event |
| Place formal hold | Visible / callable / direct rules denied | Visible | Visible | Visible | Yes | hold event + receipt |
| Resolve formal hold | Hidden / denied / denied | Visible / callable / allowed | Visible / callable / allowed | Visible / callable / allowed | Yes | reviewed + released + receipt |
| QA approve/hold | Hidden / denied / denied | Visible / callable | Visible / callable | Visible / callable | Yes | QA + operational event + receipt |
| Start/complete packaging | Hidden / denied | Visible / callable | Read-only | Visible / callable | Yes | operational event + receipt |
| Record/clear delay | Visible when enabled / transaction / allowed | Same | Same | Same | No | append-only delay event |
| Add handoff note | Visible when enabled / create / allowed | Same | Same | Same | No | immutable note itself |
| Resolve operational event | Hidden / denied | Visible / allowed | Hidden / denied | Visible / allowed | No | actor/time-bound resolution |
| Manage users/roles | Hidden / self-name only | Administrative / allowed by existing `isAdmin` | Hidden / self-name only | Administrative / allowed | Recommended admin function | admin audit still required |
| Product/profile configuration | Hidden/read-only | Visible / allowed | Read-only | Visible / allowed | No | change audit recommended |
| Training/stress tools | Build-gated off | Build-gated off | Build-gated off | Build-gated off | No | Local only |

Before staging go-live, role profiles must exist, be active, and match assigned duties. Anonymous users without an active profile receive no operational write capability.
