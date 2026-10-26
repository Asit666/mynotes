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
		@NotBlank @Size(max = 30000) String transcriptText,
		@Size(max = 5_000_000) String screenshotBase64) {

	public GenerateNoteRequest(String provider, String model, String videoTitle, String videoUrl, long timestampSeconds, String transcriptText) {
		this(provider, model, videoTitle, videoUrl, timestampSeconds, transcriptText, null);
	}
}
