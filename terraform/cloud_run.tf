# Resolve each deploy tag to an immutable Artifact Registry digest. A new digest
# is what makes Terraform create a new Cloud Run revision.
data "google_artifact_registry_docker_image" "service_images" {
  for_each = local.services

  location      = google_artifact_registry_repository.docker_repo.location
  repository_id = google_artifact_registry_repository.docker_repo.repository_id
  image_name    = "${each.value.image_name}:${each.value.image_tag}"
}

module "cloud_run_services" {
  for_each = local.services
  source   = "./modules/cloud-run-service"

  name                  = each.key
  region                = var.region
  image                 = data.google_artifact_registry_docker_image.service_images[each.key].self_link
  service_account       = google_service_account.service_runtime[each.key].email
  cpu                   = each.value.cpu
  memory                = each.value.memory
  min_instances         = each.value.min_instances
  max_instances         = each.value.max_instances
  allow_unauthenticated = each.value.allow_unauthenticated
}
