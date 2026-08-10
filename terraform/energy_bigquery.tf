locals {
  energy_dataset_id = "energy"

  energy_ingestion_table_ids = toset([
    "energy_records_staging",
    "validation_errors",
  ])
}

resource "google_bigquery_dataset" "energy" {
  dataset_id                 = local.energy_dataset_id
  friendly_name              = "Energy"
  description                = "Household energy consumption and cost data"
  location                   = var.region
  delete_contents_on_destroy = false

  labels = {
    domain     = "energy"
    managed_by = "terraform"
  }
}

resource "google_bigquery_table" "energy_records_staging" {
  dataset_id          = google_bigquery_dataset.energy.dataset_id
  table_id            = "energy_records_staging"
  description         = "Validated records waiting to be merged into energy_records"
  deletion_protection = false

  time_partitioning {
    type          = "DAY"
    field         = "ingested_at"
    expiration_ms = 604800000 # Seven days
  }

  clustering = ["source_import_id", "record_id"]

  schema = jsonencode([
    { name = "record_id", type = "STRING", mode = "REQUIRED", description = "Deterministic ID for a meter and exact period" },
    { name = "meter_id", type = "STRING", mode = "REQUIRED" },
    { name = "period_start", type = "DATE", mode = "REQUIRED" },
    { name = "period_end", type = "DATE", mode = "REQUIRED" },
    { name = "reading_start_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "reading_end_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "consumption_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "estimated_annual_kwh", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_area", type = "STRING", mode = "NULLABLE" },
    { name = "subscription_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "transmission_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "energy_tax_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_vat_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_total_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "electricity_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_annual_fee_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_vat_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_total_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "total_cost_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "source_import_id", type = "STRING", mode = "REQUIRED" },
    { name = "source_row_number", type = "INT64", mode = "REQUIRED" },
    { name = "ingested_at", type = "TIMESTAMP", mode = "REQUIRED" },
  ])
}

resource "google_bigquery_table" "energy_records" {
  dataset_id          = google_bigquery_dataset.energy.dataset_id
  table_id            = "energy_records"
  description         = "Curated monthly energy records for analysis and visualization"
  deletion_protection = true

  time_partitioning {
    type  = "MONTH"
    field = "period_start"
  }

  clustering = ["meter_id", "record_id"]

  schema = jsonencode([
    { name = "record_id", type = "STRING", mode = "REQUIRED", description = "Deterministic ID for a meter and exact period" },
    { name = "meter_id", type = "STRING", mode = "REQUIRED" },
    { name = "period_start", type = "DATE", mode = "REQUIRED" },
    { name = "period_end", type = "DATE", mode = "REQUIRED" },
    { name = "reading_start_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "reading_end_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "consumption_kwh", type = "NUMERIC", mode = "REQUIRED" },
    { name = "estimated_annual_kwh", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_area", type = "STRING", mode = "NULLABLE" },
    { name = "subscription_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "transmission_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "energy_tax_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_vat_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "grid_total_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "electricity_cost_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_annual_fee_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_vat_sek", type = "NUMERIC", mode = "NULLABLE" },
    { name = "electricity_total_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "total_cost_sek", type = "NUMERIC", mode = "REQUIRED" },
    { name = "source_import_id", type = "STRING", mode = "REQUIRED" },
    { name = "source_row_number", type = "INT64", mode = "REQUIRED" },
    { name = "created_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "updated_at", type = "TIMESTAMP", mode = "REQUIRED" },
  ])
}

resource "google_bigquery_table" "validation_errors" {
  dataset_id          = google_bigquery_dataset.energy.dataset_id
  table_id            = "validation_errors"
  description         = "Searchable row-level data validation errors"
  deletion_protection = true

  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }

  clustering = ["error_code", "import_id"]

  schema = jsonencode([
    { name = "error_id", type = "STRING", mode = "REQUIRED", description = "Deterministic ID for one row validation error" },
    { name = "import_id", type = "STRING", mode = "REQUIRED" },
    { name = "source_row_number", type = "INT64", mode = "REQUIRED" },
    { name = "field_name", type = "STRING", mode = "NULLABLE" },
    { name = "error_code", type = "STRING", mode = "REQUIRED" },
    { name = "error_message", type = "STRING", mode = "REQUIRED" },
    { name = "raw_row", type = "JSON", mode = "REQUIRED" },
    { name = "created_at", type = "TIMESTAMP", mode = "REQUIRED" },
  ])
}

# Ingestion may write only to the tables it owns. A future processing service
# will receive separate read access to staging and write access to the curated table.
resource "google_bigquery_table_iam_member" "energy_ingestion_data_editor" {
  for_each = local.energy_ingestion_enabled ? local.energy_ingestion_table_ids : toset([])

  project    = var.project_id
  dataset_id = google_bigquery_dataset.energy.dataset_id
  table_id   = each.value
  role       = "roles/bigquery.dataEditor"
  member     = google_service_account.service_runtime[local.energy_ingestion_service_name].member

  depends_on = [
    google_bigquery_table.energy_records_staging,
    google_bigquery_table.validation_errors,
  ]
}

# BigQuery load jobs require tables.create even when CREATE_NEVER targets an
# existing table. That permission can be granted only at dataset level, so use
# a custom role instead of giving the runtime dataEditor over every table.
resource "google_project_iam_custom_role" "energy_ingestion_load_job_creator" {
  count = local.energy_ingestion_enabled ? 1 : 0

  project     = var.project_id
  role_id     = "energyIngestionLoadJobCreator"
  title       = "Energy ingestion load job creator"
  description = "Minimum dataset permission required by BigQuery load jobs"
  permissions = ["bigquery.tables.create"]
}

resource "google_bigquery_dataset_iam_member" "energy_ingestion_load_job_creator" {
  count = local.energy_ingestion_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.energy.dataset_id
  role       = google_project_iam_custom_role.energy_ingestion_load_job_creator[0].name
  member     = google_service_account.service_runtime[local.energy_ingestion_service_name].member
}

# Creating query jobs is a project-level permission. It does not grant access
# to table data; table access is restricted by the bindings above.
resource "google_project_iam_member" "energy_ingestion_job_user" {
  count = local.energy_ingestion_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = google_service_account.service_runtime[local.energy_ingestion_service_name].member
}

# Processing may read only the staging table at this stage of the flow.
resource "google_bigquery_table_iam_member" "energy_processing_staging_reader" {
  count = local.energy_processing_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.energy.dataset_id
  table_id   = google_bigquery_table.energy_records_staging.table_id
  role       = "roles/bigquery.dataViewer"
  member     = google_service_account.service_runtime[local.energy_processing_service_name].member
}

# Processing owns the final table and may update or insert its records.
resource "google_bigquery_table_iam_member" "energy_processing_records_editor" {
  count = local.energy_processing_enabled ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.energy.dataset_id
  table_id   = google_bigquery_table.energy_records.table_id
  role       = "roles/bigquery.dataEditor"
  member     = google_service_account.service_runtime[local.energy_processing_service_name].member
}

# Running a SELECT requires creating a query job in the project. Table data
# access remains limited by the table-level binding above.
resource "google_project_iam_member" "energy_processing_job_user" {
  count = local.energy_processing_enabled ? 1 : 0

  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = google_service_account.service_runtime[local.energy_processing_service_name].member
}
