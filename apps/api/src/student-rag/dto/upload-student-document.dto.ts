// Upload is handled via multipart form data (Multer), so there's no body DTO for upload.
// These are simple interface-based DTOs following the codebase convention.

export interface ToggleSourceDto {
  isActive: boolean;
}

export interface ListSourcesQueryDto {
  activeOnly?: boolean;
}
