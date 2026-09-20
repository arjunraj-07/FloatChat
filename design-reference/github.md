# GitHub source

repo: AnirudhHarish07/FloatChat
branch: main

## Last sync

date: 2026-09-19T00:00:00Z

### Updated in this project

- Built the FloatChat clickable prototype (`prototype/FloatChat.html`) — nine screens on a dark-ocean layer over the Nocturne tokens.
- Data model mirrors `api/main.py`: platform / cycle / direction / data_mode / profile_id, observations with pres / depth / temp / psal / source_field.
- WOA comparison reimplements `/api/woa_match` rules client-side: bracketed standard depth, linear interpolation, 20 m maximum-gap refusal, nearest-neighbour spatial offset.
- Coverage copy follows `/api/coverage` wording ("cached historical observations"); marine-heatwave detection reported as not yet available.
- Motion rule reversed on the user's instruction (2026-09-19): the brief's "No auto rotating globe" no longer applies — the hero globe and the Explore globe now turn continuously at 60s per rotation, pausing on hover, drag, selection and hidden tab, and resuming ~2s after the user lets go. Rotation runs regardless of `prefers-reduced-motion`, also by explicit instruction.

## Screen map

| Screen (prototype/) | Built from |
| --- | --- |
| Home hero | api/main.py (`/api/coverage`) |
| Explore — map | api/main.py (`/api/floats`), Natural Earth 110m coastlines |
| Explore — globe | api/main.py (`/api/floats`) |
| Depth view | api/main.py (`/api/profiles/{profile_id}`) |
| Profile details | api/main.py (`/api/profiles/{profile_id}`, `/api/woa_match/{profile_id}`) |
| Time exploration | api/main.py (`/api/floats` profile times) |
| Compare | api/main.py (`/api/profiles/{profile_id}`) |
| AI Assistant | api/main.py (endpoint surface), scripts/data_feasibility/feasibility_summary.md |
| Analysis | api/main.py (`/api/woa_match`), scripts/data_feasibility/provenance.json |
| About | scripts/data_feasibility/feasibility_summary.md, provenance.json |

## Notes

The repository is backend-only (FastAPI + feasibility scripts); there is no frontend to recreate, so the UI was designed in this project and only the data contract was taken from the repo.
