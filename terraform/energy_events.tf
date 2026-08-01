locals {
  energy_import_staged_topic_id = "energy-import-staged"
}

resource "google_pubsub_topic" "energy_import_staged" {
  name = local.energy_import_staged_topic_id

  labels = {
    domain     = "energy"
    managed_by = "terraform"
  }
}

# Only ingestion service should be able to publish imports that are ready for processing.
resource "google_pubsub_topic_iam_member" "energy_ingestion_staged_publisher" {
  count = local.energy_ingestion_enabled ? 1 : 0

  project = var.project_id
  topic   = google_pubsub_topic.energy_import_staged.name
  role    = "roles/pubsub.publisher"
  member  = google_service_account.service_runtime[local.energy_ingestion_service_name].member
}
