resource "google_service_account" "eventarc_energy_anomaly_detection" {
  account_id   = "sa-eventarc-energy-anomaly"
  display_name = "Eventarc identity for energy anomaly detection"
  description  = "Invokes energy-anomaly-detection for completed energy imports"
}

# Restrict invocation to the energy-anomaly-detection Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "eventarc_energy_anomaly_detection_invoker" {
  count = local.energy_anomaly_detection_enabled ? 1 : 0

  name     = module.cloud_run_services[local.energy_anomaly_detection_service_name].name
  location = module.cloud_run_services[local.energy_anomaly_detection_service_name].location
  role     = "roles/run.invoker"
  member   = google_service_account.eventarc_energy_anomaly_detection.member
}

resource "google_eventarc_trigger" "energy_import_completed_anomaly" {
  count = local.energy_anomaly_detection_enabled ? 1 : 0

  name     = "energy-import-completed-anomaly"
  location = var.region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  destination {
    cloud_run_service {
      service = module.cloud_run_services[local.energy_anomaly_detection_service_name].name
      region  = module.cloud_run_services[local.energy_anomaly_detection_service_name].location
    }
  }

  transport {
    pubsub {
      topic = google_pubsub_topic.energy_import_completed.id
    }
  }

  service_account = google_service_account.eventarc_energy_anomaly_detection.email

  depends_on = [
    google_cloud_run_v2_service_iam_member.eventarc_energy_anomaly_detection_invoker,
  ]
}
