# Terraform Infrastructure

This directory contains Terraform/OpenTofu configuration for managing all GCP infrastructure.

## Structure

- `main.tf` - Provider and backend configuration
- `variables.tf` - Input variables
- `outputs.tf` - Output values
- `artifact_registry.tf` - Docker image registry
- `cloud_run.tf` - Cloud Run service definitions
- `terraform.tfvars.example` - Example configuration file

## Setup

1. Copy the example tfvars file:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Edit `terraform.tfvars` with your values

3. Initialize Terraform:
   ```bash
   tofu init
   ```

4. Plan changes:
   ```bash
   tofu plan
   ```

5. Apply changes:
   ```bash
   tofu apply
   ```

## CI/CD Integration

The GitHub Actions workflow automatically:
1. Builds and pushes Docker images to Artifact Registry
2. Runs `tofu apply` to deploy/update Cloud Run services

The Cloud Run resources use `ignore_changes` on the image tag, allowing CI/CD to update images without Terraform drift.

## Adding New Services

Add services to `terraform.tfvars`:

```hcl
services = {
  "my-new-api" = {
    image_name            = "my-new-api"
    cpu                   = "1"
    memory                = "512Mi"
    max_instances         = 10
    allow_unauthenticated = true
  }
}
```
