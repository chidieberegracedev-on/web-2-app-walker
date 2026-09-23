# Moved — see the pinned Beagle contract snapshot

This file used to hold a copy of Beagle's contract-gaps report. That copy is gone
to avoid a second source of truth.

**Beagle is the source of truth for this document.** Walker consumes a
byte-for-byte, read-only snapshot pinned to a specific Beagle commit:

- **[`contracts/beagle/WALKER_CONTRACT_GAPS.md`](../contracts/beagle/WALKER_CONTRACT_GAPS.md)** — the current pinned gaps report.
- **[`contracts/beagle/SYNC_MANIFEST.json`](../contracts/beagle/SYNC_MANIFEST.json)** — the pinned Beagle commit and per-artifact SHA-256 checksums (the drift baseline).
- **[`contracts/beagle/README.md`](../contracts/beagle/README.md)** — the read-only consumption rules.

Do not re-add a full copy here.
