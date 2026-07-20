variable "name" {
  description = "Cloud Run service name"
  type        = string
}

variable "region" {
  description = "Cloud Run service region"
  type        = string
}

variable "image" {
  description = "Immutable container image URI including its digest"
  type        = string
}

variable "service_account" {
  description = "Runtime service account email"
  type        = string
}

variable "cpu" {
  description = "CPU limit"
  type        = string
}

variable "memory" {
  description = "Memory limit"
  type        = string
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
}

variable "allow_unauthenticated" {
  description = "Whether the service is publicly invokable"
  type        = bool
}

variable "deletion_protection" {
  description = "Whether Terraform may delete the Cloud Run service"
  type        = bool
}
