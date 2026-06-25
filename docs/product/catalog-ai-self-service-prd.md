# Catalog AI Viewer Self-Service Product PRD

Date: 2026-06-23
Status: Draft, updated with product decisions
Owner: Falco

## Summary

Catalog AI Viewer should become a lightweight self-service product that turns a product catalog PDF into a branded, shareable AI catalog assistant. A user uploads a PDF, the system enriches it automatically, and the user receives a public link that buyers, prospects, or partners can open to browse the document and ask grounded questions with citations.

This is not a virtual data room. The product should avoid Peony-style diligence workflows, folder structures, NDAs, e-signatures, granular permissions, and enterprise security in the first version. The 80/20 wedge is a simple buyer enablement tool for catalogs: upload, enrich, share, learn what viewers ask.

The product will use an open-source hosted SaaS model. The application source is public under AGPL, while the hosted product charges for managed infrastructure, convenience, custom domains, branding, analytics, support, and reliability. Customer PDFs, customer data, analytics data, API keys, environment variables, and operational credentials remain private.

## Problem

Product catalogs are often dense PDFs that are hard to search, hard to explain, and hard to share in a way that creates buyer intent signals. Sales teams can send a PDF link, but they do not know which pages a prospect studied, what questions they had, or whether the catalog answered the buyer's needs.

Existing data room products solve a broader due diligence problem, but they are too heavy for the simple catalog use case. The target user needs a fast, explanatory, polished way to make a catalog interactive.

## Target Users

Primary user:

- Sales, product, or marketing operator at an industrial, manufacturing, wholesale, or technical product company.
- Has PDF catalogs, spec sheets, or brochures.
- Wants to share a smarter link with prospects without involving developers.

Viewer:

- Buyer, distributor, internal sales rep, partner, or customer.
- Opens a shared catalog link.
- Wants to search, ask questions, compare products, and jump to the relevant source page.

## Goals

- Let a non-technical user upload a PDF catalog and get a shareable AI viewer link in minutes.
- Auto-enrich each upload with a title, short description, starter questions, and retrieval hints.
- Let viewers ask questions about the catalog and receive grounded answers with page citations.
- Give the uploader basic analytics on views, questions, and high-interest pages.
- Add payments so the product can be used without manual sales or provisioning.
- Support simple branding so the shared link feels like the customer's asset, not a generic file viewer.

## Non-Goals

- Full virtual data room workflows.
- Multi-folder diligence rooms.
- NDA gating.
- E-signatures.
- Granular per-viewer permissions.
- Dynamic watermarking.
- Enterprise role management.
- Full CRM or outbound sales automation.
- Manual answer approval workflows.
- Closed-source proprietary distribution of the core app.

## Positioning

Working positioning:

> DocSend for product catalogs, with AI Q&A and page citations.

Alternative positioning:

> Turn any product catalog into a shareable AI assistant.

The product should be compared against data rooms only to clarify what it intentionally does not do. The user experience should feel much closer to uploading a deck to DocSend than configuring a VDR.

## Product Name Direction

The name should be understandable to both younger buyers and older sales or product leaders. Avoid names that are too AI-native, cryptic, or cute. The best names should say what the product does without requiring explanation.

Recommended shortlist:

1. **AskCatalog**
   Clear, literal, easy to say, and easy to understand. Strong fit for the core action: ask questions about a catalog.

2. **CatalogPilot**
   Slightly more productized and brandable. Implies guidance through a catalog, not just chat.

3. **CatalogWise**
   Friendly and broadly understandable. Less direct than AskCatalog, but more flexible as a brand.

4. **CatalogLink**
   Very simple and sales-friendly. Good if the product emphasizes shareable links and analytics.

5. **CatalogTalk**
   Conversational and approachable. More casual, but still clear.

Current recommendation: **AskCatalog** if a good domain is available. It is direct enough for a 50-year-old sales leader and still clean enough for modern SaaS positioning.

Domain purchase path:

- Use Dynadot as the registrar.
- 1Password may be used to access the Dynadot account if needed.
- No domain purchase or DNS change should happen without explicit approval of the exact domain, price, and action.

## Core User Journey

1. User lands on the marketing page and understands the product in under 10 seconds.
2. User signs up or starts a free upload.
3. User uploads a PDF catalog.
4. System processes the PDF:
   - stores the source file,
   - extracts pages, text, chunks, and bounding boxes,
   - generates embeddings when needed,
   - drafts title, description, example questions, and retrieval notes.
5. User sees a ready page with:
   - catalog title,
   - processing status,
   - preview link,
   - copy share link button,
   - editable title, notes, and suggested questions.
6. User sends the link to a viewer.
7. Viewer opens the catalog, optionally enters name and email, then asks questions.
8. User sees basic analytics for the catalog.

## MVP Scope

### 1. Marketing and Onboarding

Required:

- Public landing page with one clear CTA: upload a catalog.
- Demo catalog link.
- Short explanation of the workflow: upload PDF, get AI link, share, track questions.
- Pricing section with free and paid plans.

Acceptance criteria:

- A first-time visitor can understand the product without a sales call.
- The first screen does not look like a generic data room or file manager.

### 2. Accounts

Required:

- Uploader accounts through Supabase Auth.
- Google login if straightforward with the existing Supabase setup.
- Workspace or account ownership for catalogs.
- Viewer access without account creation.

Implementation decision:

- Use the existing Hetzner-hosted Supabase instance.
- Start with one user per workspace.
- Add teams later only when paid users ask for it.

Acceptance criteria:

- A user can sign up, log in, upload catalogs, and only see their own catalogs.
- Viewers can access shared links without creating accounts.

### 3. Upload and Enrichment

Required:

- PDF upload from the browser.
- Large file support through direct Blob upload.
- Processing status during upload, ingestion, enrichment, and readiness.
- AI-generated catalog title, summary, example questions, and retrieval notes.
- Editable metadata after processing.
- Free users can upload one catalog only.
- Free catalog limit should start at PDFs under 20 pages or the existing threshold used by the current product.

Already mostly present in the codebase:

- Blob-backed upload and storage.
- Client upload path for large files.
- PDF extraction.
- AI enrichment.
- RAG mode for large catalogs.

Acceptance criteria:

- A user can upload a PDF and receive a live catalog link without developer action.
- Failed processing produces a clear error and allows retry.

### 4. Shareable Catalog Viewer

Required:

- Stable public share URL.
- PDF viewer.
- AI chat panel.
- Suggested questions.
- Grounded answers with citations.
- Citation click jumps to the relevant page and region.

Optional for MVP:

- Lead capture gate before viewing or before first AI question.

Acceptance criteria:

- A viewer can open a shared link, ask a question, and verify the answer in the PDF.
- The experience works without requiring the viewer to understand the underlying AI or retrieval system.

### 5. Analytics

Required:

- Product analytics instrumentation with PostHog.
- Per-catalog summary analytics in the app.

Track these events:

- `catalog_uploaded`
- `catalog_processing_started`
- `catalog_processing_completed`
- `catalog_processing_failed`
- `share_link_copied`
- `viewer_opened_catalog`
- `viewer_submitted_email`
- `viewer_asked_question`
- `viewer_clicked_citation`
- `viewer_viewed_page`

Per-catalog analytics page:

- total views,
- unique viewers,
- questions asked,
- top questions,
- most viewed pages,
- latest viewer sessions.

Acceptance criteria:

- The uploader can tell whether a shared catalog is getting attention.
- The uploader can see what viewers are asking.
- Raw analytics can live in PostHog first, but the app must expose a small useful summary.

### 6. Payments

Required:

- Stripe Checkout for subscription purchase.
- Stripe customer portal for plan management.
- Stripe webhooks to sync subscription status.
- Plan limits enforced in the app.

Initial plans:

- Free: 1 catalog upload, maximum 3 viewer questions, maximum 20 pages, product branding remains visible.
- Paid: $39 per month, more catalogs, practical question limits, custom domain, logo upload, branding, analytics.

Acceptance criteria:

- A user can upgrade without founder involvement.
- Catalog limits and question limits are enforced server-side.
- A canceled subscription downgrades access predictably.
- Pricing stays simple enough to explain in one sentence.

### 7. Branding

Required:

- Customer logo.
- Company name.
- Primary color.
- Catalog-specific title and description.
- Custom share slug.
- Custom domain for paid users.

Later:

- Cover image.
- Multiple brand themes per workspace.

Acceptance criteria:

- A shared catalog can look like it belongs to the customer's company.
- Branding controls are simple enough to configure in under two minutes.

## Data Model

Minimum relational tables:

- `users`
  - `id`
  - `email`
  - `name`
  - `created_at`

- `workspaces`
  - `id`
  - `name`
  - `owner_user_id`
  - `stripe_customer_id`
  - `subscription_status`
  - `plan`
  - `custom_domain`
  - `logo_blob_path`
  - `primary_color`
  - `created_at`

- `catalogs`
  - `id`
  - `workspace_id`
  - `name`
  - `slug`
  - `description`
  - `notes`
  - `example_questions`
  - `num_pages`
  - `mode`
  - `pdf_blob_path`
  - `metadata_blob_path`
  - `vector_blob_path`
  - `status`
  - `question_limit`
  - `question_count`
  - `created_at`
  - `updated_at`

- `share_links`
  - `id`
  - `catalog_id`
  - `slug`
  - `is_active`
  - `lead_capture_enabled`
  - `created_at`

- `viewer_sessions`
  - `id`
  - `catalog_id`
  - `share_link_id`
  - `viewer_email`
  - `viewer_name`
  - `posthog_distinct_id`
  - `first_seen_at`
  - `last_seen_at`

- `questions`
  - `id`
  - `catalog_id`
  - `viewer_session_id`
  - `question`
  - `answer_preview`
  - `created_at`

- `page_views`
  - `id`
  - `catalog_id`
  - `viewer_session_id`
  - `page`
  - `dwell_ms`
  - `created_at`

Blob storage remains responsible for:

- source PDFs,
- extracted catalog JSON,
- vector JSON.

## Licensing and Source Model

The product will remain AGPL open source because the current PDF extraction stack uses MuPDF, which is licensed under AGPL unless a commercial Artifex license is purchased. This is acceptable for the chosen business model.

Public source includes:

- application code,
- database migrations,
- self-hosting instructions,
- core upload, extraction, viewer, and chat logic,
- basic product documentation.

Private hosted-service data includes:

- customer PDFs,
- customer metadata,
- viewer analytics,
- billing records,
- API keys,
- Supabase service role keys,
- Stripe keys,
- Google model keys,
- Dynadot credentials,
- deployment secrets,
- private operational notes.

Hosted product monetization:

- managed hosting,
- storage and processing,
- simple billing,
- custom domains,
- logo upload and branding,
- analytics,
- support,
- reliability and maintenance.

AGPL obligations:

- The hosted service must offer users access to the corresponding source code of the deployed application version.
- Source releases must not include secrets, customer data, private logs, or private infrastructure credentials.
- Deployment automation should make it easy to link a running version to the matching public commit.

## Permissions

Uploader:

- Can create, edit, delete, and share own catalogs.
- Can view analytics for own catalogs.
- Can manage billing for own workspace.

Viewer:

- Can open active shared links.
- Can ask questions within plan and rate limits.
- Does not need an account.

Admin:

- Internal support role can inspect catalogs only if explicitly added later.

## AI Behavior

The AI assistant must:

- answer only from the catalog,
- cite source chunks,
- admit when the answer is not present,
- avoid invented product claims,
- use the uploader's notes as retrieval guidance,
- preserve page citations in the UI.

For large catalogs:

- use embedding retrieval,
- send only top relevant chunks,
- never attach the full PDF when the catalog is in RAG mode.

For small catalogs:

- full-PDF mode can remain if cost and latency are acceptable.

## Product Metrics

Activation:

- percent of users who upload a catalog after signup,
- percent of uploads that complete successfully,
- time from signup to share link copied.

Engagement:

- viewer opens per catalog,
- questions per viewer,
- citation clicks per answer,
- repeat viewer sessions.

Revenue:

- free to paid conversion,
- paid catalog count,
- monthly AI usage per plan,
- churn by plan.

Quality:

- failed upload rate,
- failed chat response rate,
- uncited answer rate,
- user-reported bad answers.

## Risks

- PDF parsing quality may vary by catalog format.
- AI answers can be wrong if retrieval misses the right chunks.
- Large catalogs may create high embedding and inference costs.
- Competitors can inspect and self-host the AGPL code.
- Analytics can become expensive or noisy if every page event is captured too aggressively.
- Viewer privacy expectations must be clear if lead capture and question logging are enabled.

## Open Decisions

1. What exact product name and domain should be purchased?
2. What is the existing Hetzner Supabase connection string and project configuration?
3. Is Google login already enabled or should it be configured in Supabase?
4. Should the free 3-question limit apply per catalog lifetime or per month?
5. What should the paid plan's catalog and monthly question limits be?
6. Should lead capture be included in the $39 plan or added later?
7. Should a commercial MuPDF license still be explored later to allow proprietary licensing options?

## Recommended Build Sequence

1. Connect the app to the existing Hetzner-hosted Supabase database.
2. Add Supabase Auth with Google login if straightforward.
3. Add relational ownership for users, workspaces, catalogs, share links, and question counts.
4. Convert the current admin dashboard into a user dashboard.
5. Enforce the free plan: 1 catalog, 3 questions, page limit.
6. Add Stripe Checkout, webhooks, customer portal, and $39 paid entitlement.
7. Add share links separate from internal catalog IDs.
8. Add custom logo upload and workspace branding.
9. Add custom domains for paid users.
10. Add PostHog instrumentation.
11. Add a basic catalog analytics page.
12. Add marketing landing page and demo flow.
13. Add lead capture if it does not slow down the first paid launch.

## Launch Criteria

The product is ready for first external self-service users when:

- a user can sign up,
- upload a PDF,
- receive a live share link,
- share it with a viewer,
- have the viewer ask questions with citations,
- see basic analytics,
- upgrade through Stripe,
- and stay within enforced plan limits.

Public-source launch criteria:

- The public repo contains no secrets.
- The public repo includes AGPL license and NOTICE files.
- The hosted app footer or settings page links to the public source code.
- The deployment process records the public git commit deployed to production.
