locals {
  energy_ingestion_service_name         = "energy-ingestion"
  energy_processing_service_name        = "energy-processing"
  energy_anomaly_detection_service_name = "energy-anomaly-detection"

  default_services = {
    (local.energy_ingestion_service_name) = {
      image_name            = local.energy_ingestion_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
      deletion_protection   = true
      environment_variables = {
        MAX_CSV_FILE_SIZE_BYTES       = "10485760" # 10 MiB
        ENERGY_DATASET_ID             = "energy"
        ENERGY_IMPORT_STAGED_TOPIC_ID = google_pubsub_topic.energy_import_staged.name
        GCP_REGION                    = var.region
      }
    }
    (local.energy_processing_service_name) = {
      image_name            = local.energy_processing_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
      deletion_protection   = true
      environment_variables = {
        ENERGY_DATASET_ID                = "energy"
        ENERGY_IMPORT_COMPLETED_TOPIC_ID = google_pubsub_topic.energy_import_completed.name
        GCP_REGION                       = var.region
      }
    }
    (local.energy_anomaly_detection_service_name) = {
      image_name            = local.energy_anomaly_detection_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
      deletion_protection   = true
      environment_variables = {
        ENERGY_DATASET_ID = "energy"
        GCP_REGION        = var.region
      }
    }
  }

  services = var.services == null ? local.default_services : var.services

  energy_ingestion_enabled         = contains(keys(local.services), local.energy_ingestion_service_name)
  energy_processing_enabled        = contains(keys(local.services), local.energy_processing_service_name)
  energy_anomaly_detection_enabled = contains(keys(local.services), local.energy_anomaly_detection_service_name)
}
