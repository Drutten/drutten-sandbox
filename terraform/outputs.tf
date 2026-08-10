output "cloud_run_urls" {
  description = "URLs of deployed Cloud Run services"
  value = {
    for k, v in module.cloud_run_services : k => v.url
  }
}

output "cloud_run_service_accounts" {
  description = "Runtime service account emails by service"
  value = {
    for k, v in google_service_account.service_runtime : k => v.email
  }
}

output "artifact_registry_url" {
  description = "Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}"
}

output "energy_upload_bucket" {
  description = "Bucket that receives energy CSV files"
  value       = google_storage_bucket.energy_uploads.name
}

output "energy_bigquery_dataset" {
  description = "BigQuery dataset for the energy domain"
  value       = google_bigquery_dataset.energy.dataset_id
}

output "energy_import_firestore_database" {
  description = "Firestore database used for import workflow state"
  value       = google_firestore_database.energy_import_control.name
}

output "energy_import_staged_topic" {
  description = "Pub/Sub topic for imports ready for processing"
  value       = google_pubsub_topic.energy_import_staged.name
}

output "energy_import_completed_topic" {
  description = "Pub/Sub topic for successfully processed imports"
  value       = google_pubsub_topic.energy_import_completed.name
}
