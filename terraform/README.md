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

3. Configure the GCS backend (one-time, local only):

   ```bash
   cp backend.hcl.example backend.hcl
   # Edit backend.hcl with the state bucket name
   ```

4. Initialize Terraform:

   ```bash
   tofu init -backend-config=backend.hcl
   ```

5. Plan changes:

   ```bash
   tofu plan
   ```

6. Apply changes:
   ```bash
   tofu apply
   ```

## CI/CD Integration

The GitHub Actions workflow automatically:

1. Uses Nx to select affected deployable applications
2. Builds and pushes each image with both a Git SHA and `latest` tag
3. Resolves `latest` to an immutable Artifact Registry digest
4. Runs `tofu apply` to create or update only changed Cloud Run services

Terraform owns the deployed image. GitHub Actions serializes deployments so a
second run cannot move `latest` while the first run is planning.

Each service also gets a dedicated runtime service account with no additional
IAM roles by default. Grant permissions separately and on the narrowest useful
resource only when an application needs them.

## Bootstrap Order

For an empty GCP project, deploy in two phases because a Cloud Run service can
only reference an image that already exists:

1. Apply the configuration with `services = {}` to create Artifact Registry.
2. Build and push the initial application image.
3. Enable the service and apply again to create Cloud Run.

The repository currently enables the `api` service by default because its image
has already been pushed.

After this one-time bootstrap, a normal merge to `main` performs the image push
and Cloud Run deployment in the same pipeline run. The image is pushed first,
then Terraform resolves its digest and creates or updates the service.

## Adding New Services

Add services to `terraform.tfvars`:

```hcl
services = {
  "my-new-api" = {
    image_name            = "my-new-api"
    image_tag             = "latest"
    cpu                   = "1"
    memory                = "512Mi"
    max_instances         = 10
    allow_unauthenticated = false
  }
}
```
