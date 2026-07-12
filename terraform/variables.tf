variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-west1"
}

variable "docker_image_path" {
  description = "Base path for Docker images in Artifact Registry"
  type        = string
}

variable "services" {
  description = "Map of Cloud Run services to deploy"
  type = map(object({
    image_name            = string
    cpu                   = optional(string, "1")
    memory                = optional(string, "512Mi")
    max_instances         = optional(number, 10)
    min_instances         = optional(number, 0)
    allow_unauthenticated = optional(bool, true)
  }))
  default = {}
}
