# Each Cloud Run service gets its own runtime identity. Resource-specific IAM
# permissions are granted separately only when an application needs them.
resource "google_service_account" "service_runtime" {
  for_each = local.services

  account_id   = "sa-${each.key}"
  display_name = "Runtime identity for ${each.key}"
  description  = "Service account for the ${each.key} Cloud Run service"
}
