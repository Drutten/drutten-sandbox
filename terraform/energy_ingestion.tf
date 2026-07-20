resource "google_storage_bucket" "energy_uploads" {
  name     = "${var.project_id}-energy-uploads"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
}

resource "google_service_account" "eventarc_energy_ingestion" {
  account_id   = "sa-eventarc-energy-ingestion"
  display_name = "Eventarc identity for energy ingestion"
  description  = "Invokes energy-ingestion for finalized Cloud Storage objects"
}

# Eventarc requires this project-level role for the trigger identity.
resource "google_project_iam_member" "eventarc_energy_ingestion_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = google_service_account.eventarc_energy_ingestion.member
}

# Restrict invocation to the one private Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "eventarc_energy_ingestion_invoker" {
  count = local.energy_ingestion_enabled ? 1 : 0

  name     = module.cloud_run_services[local.energy_ingestion_service_name].name
  location = module.cloud_run_services[local.energy_ingestion_service_name].location
  role     = "roles/run.invoker"
  member   = google_service_account.eventarc_energy_ingestion.member
}

# The ingestion runtime may read objects only from its upload bucket.
resource "google_storage_bucket_iam_member" "energy_ingestion_object_viewer" {
  count = local.energy_ingestion_enabled ? 1 : 0

  bucket = google_storage_bucket.energy_uploads.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.service_runtime[local.energy_ingestion_service_name].member
}

# Direct Cloud Storage events use Pub/Sub as Eventarc's transport layer.
resource "google_project_iam_member" "gcs_eventarc_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gs-project-accounts.iam.gserviceaccount.com"

  depends_on = [google_storage_bucket.energy_uploads]
}

resource "google_eventarc_trigger" "energy_file_uploaded" {
  count = local.energy_ingestion_enabled ? 1 : 0

  name     = "energy-file-uploaded"
  location = var.region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.storage.object.v1.finalized"
  }

  matching_criteria {
    attribute = "bucket"
    value     = google_storage_bucket.energy_uploads.name
  }

  destination {
    cloud_run_service {
      service = module.cloud_run_services[local.energy_ingestion_service_name].name
      region  = module.cloud_run_services[local.energy_ingestion_service_name].location
    }
  }

  service_account = google_service_account.eventarc_energy_ingestion.email

  depends_on = [
    google_cloud_run_v2_service_iam_member.eventarc_energy_ingestion_invoker,
    google_project_iam_member.eventarc_energy_ingestion_event_receiver,
    google_project_iam_member.gcs_eventarc_publisher,
  ]
}
