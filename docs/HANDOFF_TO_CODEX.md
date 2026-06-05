# HANDOFF TO CODEX

## A) Project overview

This repository is a **Telegram AI Instagram bot** for **MC Clinic Medical**.

Primary purpose:
- receive content/materials in Telegram,
- generate medically safe Instagram content,
- preview and approve drafts,
- publish to Instagram via Graph API.

---

## B) What already works

The following capabilities are considered implemented/validated in the latest working baseline:

- Telegram bot polling mode
- OpenAI caption generation
- Supabase Storage upload
- Instagram Graph API publishing
- Successful Post publishing to Instagram
- Media design layer
- Text-to-poster mode
- AI assistant mode
- Agent router (partially)
- Caption formatter
- Tests passing in the validated baseline

---

## C) Confirmed non-secret values

These values are safe/non-secret and confirmed:

- `FACEBOOK_PAGE_ID=1206870099170923`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID=17841432826668752`
- `INSTAGRAM_USERNAME=mc_clinic.du`
- `SUPABASE_URL=https://qcnkkyyjwbproyausvmk.supabase.co`
- `SUPABASE_STORAGE_BUCKET=instagram-media`
- `SUPABASE_PUBLIC_FOLDER=mc-clinic-ai`
- `TELEGRAM_MODE=polling`
- `OPENAI_MODEL=gpt-4.1-mini`

---

## D) Required env variables (names only, no values)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `META_APP_ID`
- `META_APP_SECRET`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `FACEBOOK_PAGE_ID`
- `INSTAGRAM_USERNAME`
- `MEDIA_STORAGE_PROVIDER`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_PUBLIC_FOLDER`
- `TELEGRAM_MODE`
- `TELEGRAM_WEBHOOK_URL`
- `PUBLIC_BASE_URL`
- `LOG_LEVEL`
- `OPENAI_IMAGE_GENERATION_ENABLED`
- `OPENAI_IMAGE_MODEL`

---

## E) Architecture map (key files)

> Status is from current repository tree at handoff time.

- `src/bot/bot.ts` — Telegram handlers, command routing, draft flow, approval callbacks. **(present)**
- `src/services/openai.service.ts` — text generation and assistant interaction with OpenAI. **(present)**
- `src/services/instagram.service.ts` — Instagram Graph API integration and publishing flow. **(present)**
- `src/services/media-design.service.ts` — image design/branding layer for media drafts. **(missing in current tree)**
- `src/services/text-poster-design.service.ts` — text-only poster generation service. **(missing in current tree)**
- `src/services/agent-router.service.ts` — task/action router for assistant agent behavior. **(missing in current tree)**
- `src/services/visual-planner.service.ts` — visual planning/orchestration (if implemented). **(missing in current tree)**
- `src/services/draft-edit.service.ts` — natural-language draft modification pipeline. **(missing in current tree)**
- `src/services/assistant-command.service.ts` — assistant intent parsing/classification. **(missing in current tree)**
- `src/services/caption-formatter.service.ts` — caption cleanup/safety/formatting. **(missing in current tree)**
- `src/services/competitor-analysis.service.ts` — competitor input analysis mode. **(missing in current tree)**
- `src/services/openai-image.service.ts` — optional AI image generation. **(missing in current tree)**
- `src/config/brand.ts` — brand memory/config profile. **(missing in current tree)**
- `src/db/database.ts` — SQLite access layer, data CRUD, migrations helper. **(present)**
- `src/db/schema.sql` — DB schema definition. **(present)**

---

## F) npm scripts (from current package.json)

- `dev`
- `build`
- `start`
- `check`
- `test:env`
- `test:storage`
- `test:instagram`
- `test:instagram-publish`
- `test:telegram`
- `debug:instagram-access`

---

## G) What was manually confirmed to work

- Telegram photo → Post → RU → Approve → Instagram post published
- OpenAI generation works after billing fix
- Supabase Storage public URL works
- Instagram account/page linkage is valid and `test:instagram` passes

---

## H) Current known issues / gaps

- Visual quality still weak in some outputs
- Posters may look too empty in some cases
- Bot can still give advice instead of creating/changing visual in edge flows
- Active draft natural-language editing needs stronger Visual Planner
- Buttons remain too central; natural language should be primary control
- Story/Reel paths not fully validated end-to-end
- Direct auto-reply is not implemented yet
- Production deployment hardening is still pending
- Token rotation required before real production rollout

---

## I) Recommended next stage

### Creative AI Engine v2

Focus areas:
- Visual Planner
- denser/filled poster layouts
- infographic cards
- carousel generation
- stronger natural-language editing
- less button-dependent UX
- better visual templates
- no blank center artifacts
- no generic advice when user asks to create visual

---

## J) What NOT to do yet

- Do not change Meta setup
- Do not change Instagram/Facebook IDs unless tests prove they are wrong
- Do not implement Direct auto-replies yet
- Do not add Redis/PostgreSQL/OAuth/SaaS/Admin panel yet
- Do not print secrets

