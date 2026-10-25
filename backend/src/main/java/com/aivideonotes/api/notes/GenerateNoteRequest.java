package com.aivideonotes.api.notes;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GenerateNoteRequest(
		@NotBlank @Size(max = 30) String provider,
		@NotBlank @Size(max = 200) String model,
		@NotBlank @Size(max = 200) String videoTitle,
		@NotBlank @Size(max = 2048) String videoUrl,
		@Min(0) long timestampSeconds,
		@NotBlank @Size(max = 30000) String transcriptText) {
}
