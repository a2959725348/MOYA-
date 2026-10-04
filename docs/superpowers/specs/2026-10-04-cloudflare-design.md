# Cloudflare backend adaptation

Approved scope: the user explicitly requested implementing the previously proposed GitHub → Cloudflare Pages + Functions + D1 deployment. Preserve the Node/Windows deployment and existing uncommitted agent fixes. No account publication or private data upload during implementation.

The React frontend keeps its same-origin API contract. Pages Functions execute Fetch API routes; D1 holds account, encrypted settings, records, sessions and synchronization snapshots. VAULT_KEY is a Cloudflare encrypted secret containing the original 32-byte key encoded as base64. Existing scrypt password hashes and AES-256-GCM encrypted settings remain compatible.

D1 writes use atomic batches and a revision compare-and-swap. Pure database operations may retry conflicts; a paid upstream AI request must never be replayed by a database retry. The daily AI request limit is reserved before contacting the provider. Cloudflare market refresh uses request-driven caching rather than a process timer.

Deliver source-only upload ZIP, ignored private export tool, deployment guide, meaningful database/API/SSE tests and a Workers runtime smoke test. Never include environment files, key files, databases, private exports or offline server packages in the source archive.
