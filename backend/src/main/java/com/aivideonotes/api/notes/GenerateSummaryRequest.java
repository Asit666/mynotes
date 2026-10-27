package com.aivideonotes.api.notes;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GenerateSummaryRequest(
		@NotBlank @Size(max = 30) String provider,
		@NotBlank @Size(max = 200) String model,
		@NotBlank @Size(max = 200) String videoTitle,
		@NotBlank @Size(max = 2048) String videoUrl,
		@NotBlank @Size(max = 150_000) String fullNotesMarkdown) {
}
