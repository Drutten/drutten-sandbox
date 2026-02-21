# Cloud Run services deployed from the monorepo
resource "google_cloud_run_v2_service" "services" {
  for_each = var.services

  name     = each.key
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image = "${var.docker_image_path}/${each.value.image_name}:latest"

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image, # Allow CI/CD to update image
    ]
  }
}

# IAM policy to allow public access (if needed)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  for_each = {
    for k, v in var.services : k => v
    if v.allow_unauthenticated
  }

  name     = google_cloud_run_v2_service.services[each.key].name
  location = google_cloud_run_v2_service.services[each.key].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
