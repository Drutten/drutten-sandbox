output "cloud_run_urls" {
  description = "URLs of deployed Cloud Run services"
  value = {
    for k, v in google_cloud_run_v2_service.services : k => v.uri
  }
}

output "artifact_registry_url" {
  description = "Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}"
}
