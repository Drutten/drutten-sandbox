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
```

The `energy-ingestion` service currently:

1. Receives an authenticated object-finalized event from Eventarc.
2. Downloads the exact GCS object generation.
3. Creates a deterministic import ID from bucket, object name, and generation.
4. Parses the CSV one row at a time.
5. Writes structured metadata and the parsed row count to Cloud Logging.

CSV validation, deduplication, import tracking, and BigQuery persistence will
be added incrementally.

## Local development

Install dependencies:

```bash
pnpm install
```

Useful Nx commands:

```bash
pnpm exec nx serve energy-ingestion
pnpm exec nx build energy-ingestion
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
