resource "google_service_account" "eventarc_energy_processing" {
  account_id   = "sa-eventarc-energy-processing"
  display_name = "Eventarc identity for energy processing"
  description  = "Invokes energy-processing for staged energy imports"
}

# Restrict invocation to the energy-processing Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "eventarc_energy_processing_invoker" {
  count = local.energy_processing_enabled ? 1 : 0

  name     = module.cloud_run_services[local.energy_processing_service_name].name
  location = module.cloud_run_services[local.energy_processing_service_name].location
  role     = "roles/run.invoker"
  member   = google_service_account.eventarc_energy_processing.member
}

resource "google_eventarc_trigger" "energy_import_staged" {
  count = local.energy_processing_enabled ? 1 : 0

  name     = "energy-import-staged"
  location = var.region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  destination {
    cloud_run_service {
      service = module.cloud_run_services[local.energy_processing_service_name].name
      region  = module.cloud_run_services[local.energy_processing_service_name].location
    }
  }

  transport {
    pubsub {
      topic = google_pubsub_topic.energy_import_staged.id
    }
  }

  service_account = google_service_account.eventarc_energy_processing.email

  depends_on = [
    google_cloud_run_v2_service_iam_member.eventarc_energy_processing_invoker,
  ]
}
