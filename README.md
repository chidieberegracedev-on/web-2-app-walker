# web-2-app-walker
Walker — Railway-based discovery, AI analysis, asset ingestion, and asynchronous processing worker for Web-to-App.

You are working exclusively in the Walker repository — the Discovery Worker (Railway) for the website-to-app builder. Do not code yet. Read first, assess, then propose.

Step 1 — Read, in this order, before any implementation decision:

docs/WALKER_PROJECT_HANDOFF.md — what Walker is, owns, and must never do.
docs/WALKER_BEAGLE_INTEGRATION_CONTRACT.md — the frozen API contract for talking to Beagle. Authoritative.
docs/WALKER_IMPLEMENTATION_PLAN.md — the phased build (W1–W6).
docs/WALKER_CLAUDE_CODE_RULES.md — your operating rules and the document hierarchy.
Then the 19 original project documents in docs/ — completely, for full product/architecture context.

Step 2 — Document hierarchy (from the rules file). When two documents disagree, highest wins: the frozen integration contract > the Walker handoff/rules > TECHNICAL_DECISIONS.md > the 19 original specs > older planning docs. For anything about how Walker talks to Beagle, the frozen contract is right even if an older spec says otherwise — it describes a deployed, verified system.

Step 3 — Absorb these hard boundaries (full list in the rules file):

Work only in this repo. Never read, clone, or modify the Beagle repository.
Beagle is deployed at https://web-2-app-backend-api.vercel.app. Build against the frozen contract exactly — never invent an undocumented endpoint or behavior.
Never connect to Supabase/Postgres/Storage directly. Walker gets DISCOVERY_WORKER_SECRET + Beagle's base URL, and never a Supabase credential.
Walker never builds a Blueprint — it submits discovery data, classifications, recommendations, and asset refs; Beagle constructs the Blueprint.
Implement the asset-fetch SSRF safety ruleset exactly as the contract specifies.
If anything you need isn't in the contract, or a task seems to require crossing a boundary: stop and surface it. Do not guess, invent, or work around it.

Step 4 — Before writing any code, produce for my approval:

A brief assessment confirming what you read and any conflicts or gaps you noticed between documents.
Your proposed Phase W1 plan (skeleton + authenticated contact with deployed Beagle — auth client, job claim, failure reporting, verified against real HTTPS).
