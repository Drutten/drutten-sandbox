# Drutten Sandbox

An Nx monorepo for incrementally building an event-driven data ingestion
system in GCP. The project demonstrates distributed system design, CI/CD,
least-privilege IAM, Cloud Run, Eventarc, Cloud Storage, and infrastructure as
code.

The system ingests monthly household energy consumption and cost data from CSV
files for validation, analysis, and visualization.

## Current architecture

```text
CSV upload -> Cloud Storage -> Eventarc -> energy-ingestion (Cloud Run)
                                      |-> Firestore (import state)
                                      |-> BigQuery (staging and validation errors)
                                      `-> Pub/Sub (EnergyImportStaged)
                                                `-> Eventarc -> energy-processing
```

The `energy-ingestion` service currently:

1. Receives an authenticated object-finalized event from Eventarc.
2. Streams the exact GCS object generation.
3. Creates a deterministic import ID from bucket, object name, and generation.
4. Claims the import run atomically in Firestore.
5. Parses and validates the CSV one row at a time.
6. Loads valid rows and validation errors to BigQuery in bounded batches.
7. Marks the import `STAGED` only after both BigQuery outputs succeed.
8. Publishes `EnergyImportStaged` with a deterministic event ID.

Firestore is the control plane for operational import state. BigQuery is the
data plane for records and searchable validation errors. Deduplication into
the processed `energy_records` table will be handled by a separate processing
service.

The `energy-processing` service currently receives and validates staged-import
events. Its idempotent BigQuery merge into `energy_records` is the next
increment.

## Local development

Install dependencies:

```bash
pnpm install
```

Useful Nx commands:

```bash
pnpm exec nx serve energy-ingestion
pnpm exec nx build energy-ingestion
pnpm exec nx serve energy-processing
pnpm exec nx build energy-processing
pnpm exec nx graph
```

## Deployment

GitHub Actions uses Nx to find affected applications, builds and pushes their
container images to Artifact Registry, and then applies the Terraform/OpenTofu
configuration.

GitHub Actions authenticates to GCP using keyless Workload Identity Federation.
See [GCP_SETUP.md](GCP_SETUP.md) for the one-time GCP and CI/CD setup.

See [terraform/README.md](terraform/README.md) for infrastructure setup,
bootstrap order, IAM, and deployment details.
