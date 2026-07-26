resource "google_firestore_database" "energy_import_control" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Keep the database if this resource is ever removed from Terraform.
  deletion_policy = "ABANDON"
}

# Firestore IAM is project-level. This role lets the ingestion runtime manage
# import run documents.
resource "google_project_iam_member" "energy_ingestion_firestore_user" {
  count = local.energy_ingestion_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.service_runtime[local.energy_ingestion_service_name].member
}
