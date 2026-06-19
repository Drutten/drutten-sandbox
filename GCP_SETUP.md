# GCP CI/CD Setup — Quick Reference

This repository uses **GitHub Actions with Workload Identity Federation (OIDC)** to authenticate to Google Cloud.

This document is a short reminder of the **important things to remember** when setting it up.

---

## What must exist in GCP

- A GCP **project**
- A dedicated **CI/CD service account** (no keys)
- A **Workload Identity Pool** named `github`
- A **Workload Identity Provider** named `github`
- An **Artifact Registry** Docker repository
- A **GCS bucket** for Terraform/OpenTofu state

---

## APIs that must be enabled

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com
```

---

## CI/CD service account

- Use a **dedicated** service account for GitHub Actions
- **Never** create or commit service account keys
- Grant **least-privilege IAM roles** only
- Required roles for this setup:
  - `roles/run.admin` - Deploy Cloud Run services
  - `roles/artifactregistry.admin` - Push/pull Docker images
  - `roles/iam.serviceAccountUser` - Act as service account
  - `roles/storage.admin` - Terraform state (if using GCS backend)

---

## GitHub Secrets Required

Add these in your repo: **Settings → Secrets and variables → Actions**

**Secrets:**
- `GCP_PROJECT_NUMBER` - Your GCP project number (not ID)
- `GCP_SERVICE_ACCOUNT` - Email: `github-actions@PROJECT_ID.iam.gserviceaccount.com`

**Variables:**
- `DOCKER_IMAGE_PATH` - Example: `europe-west1-docker.pkg.dev/PROJECT_ID/drutten-sandbox` (needed when enabling Docker push)

---

## Step-by-Step Setup

### 1. Set Environment Variables

```bash
export PROJECT_ID="your-gcp-project-id"
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
export REGION="europe-west1"
export GITHUB_USERNAME="your-github-username"
export GITHUB_REPO="${GITHUB_USERNAME}/drutten-sandbox"
```

### 2. Enable Required APIs

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com
```

### 3. Create Workload Identity Pool & Provider

```bash
# Create Workload Identity Pool
gcloud iam workload-identity-pools create "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create Provider
gcloud iam workload-identity-pools providers create-oidc "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='${GITHUB_USERNAME}' && assertion.repository=='${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

### 4. Create Service Account & Grant Permissions

```bash
# Create service account
gcloud iam service-accounts create github-actions \
  --project="${PROJECT_ID}" \
  --display-name="GitHub Actions"

# Grant required roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Allow GitHub to impersonate service account
gcloud iam service-accounts add-iam-policy-binding \
  github-actions@${PROJECT_ID}.iam.gserviceaccount.com \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"
```

### 5. Add GitHub Secrets & Update Workflow

Go to your GitHub repo → **Settings → Secrets and variables → Actions → Secrets**

Add these secrets:
- `GCP_PROJECT_NUMBER` = `<your project number>`
- `GCP_SERVICE_ACCOUNT` = `github-actions@<PROJECT_ID>.iam.gserviceaccount.com`

Update environment variables in ci-cd.yml with your values

### 6. Push and Deploy

```bash
git add .
git commit -m "Initial setup"
git push
```
