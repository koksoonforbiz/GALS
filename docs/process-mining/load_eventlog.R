# Load the GALS prompting-course event log into bupaR (Phase 7 #8).
#
# Export first (teacher/admin token; RESEARCH_EXPORT_SALT set on the API):
#   GET /api/learning-events/courses/<courseId>/export/event-log.csv?format=eventlog
# then:
#   Rscript docs/process-mining/load_eventlog.R event-log.csv
#
# Exits non-zero if bupaR::eventlog() rejects the file.

suppressPackageStartupMessages({
  library(bupaR)
})

args <- commandArgs(trailingOnly = TRUE)
path <- if (length(args) >= 1) args[[1]] else "event-log.csv"

df <- read.csv(path, stringsAsFactors = FALSE)
df$timestamp <- as.POSIXct(df$timestamp, format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC")
stopifnot(!anyNA(df$timestamp))

el <- eventlog(
  df,
  case_id = "case_id",
  activity_id = "activity",
  activity_instance_id = "activity_instance",
  lifecycle_id = "lifecycle",
  timestamp = "timestamp",
  resource_id = "resource"
)

cat("cases:", n_cases(el), " activities:", n_activities(el),
    " activity instances:", n_activity_instances(el), " events:", n_events(el), "\n")
print(activity_frequency(el, level = "activity"))
