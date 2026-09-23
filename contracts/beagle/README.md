# Beagle contract snapshot (read-only, pinned)

These files are a **byte-for-byte, read-only snapshot** of Beagle's Walker-facing
contract artifacts, pinned at a specific Beagle `main` commit. **Beagle is the
canonical contract authority; Walker is a consumer.**

- Pinned commit and per-file source paths + SHA-256 checksums: see
  [`SYNC_MANIFEST.json`](./SYNC_MANIFEST.json).
- Source repository: `https://github.com/chidieberegracedev-on/web-2-app-backend-api-`, branch `main`.

## Rules

- **Do not edit these copies.** They are consumption artifacts, not an
  independent source of truth. If Walker disagrees with the contract, report the
  discrepancy for Beagle to fix **at the authority** — never edit a local copy to
  resolve a disagreement.
- **Never** edit, commit, branch, or push to the Beagle repository.
- The `SYNC_MANIFEST.json` checksums are the **drift baseline**. On any future
  authorized re-sync, recompute each Beagle source artifact's SHA-256 and compare:
  a changed checksum means the contract changed → re-sync → re-record the SHA →
  re-run contract tests → adjust implementation if needed.

## Note on source paths

The integration contract lives **one level up** from the machine-readable
artifacts in the Beagle tree:

- `doc/backend/WALKER_BEAGLE_INTEGRATION_CONTRACT.md` (prose contract)
- `doc/backend/contracts/*.json` and `WALKER_CONTRACT_GAPS.md`

The manifest records each exact source path so a re-sync cannot silently miss the
integration contract's different location.

## Relationship to `docs/`

Walker's `docs/` directory holds earlier working copies of some of these
artifacts that predate this pinned snapshot; where they differ, **this snapshot
(pinned at the manifest's commit) is authoritative** for what Walker builds
against. Reconciling or superseding the `docs/` copies is a separate, explicitly
authorized step.
